import {assertApproved,digest,recordExpense} from "./release-policy.mjs";
import {quoteStep,assertPlanTarget} from "./publication-budget.mjs";
import {estimateBaseFees,actualBaseFees} from './base-fees.mjs';
import {rpcRequest} from './rpc-relay.mjs';
import {
  Contract,
  Interface,
  JsonRpcProvider,
  getAddress,
  hexlify,
  formatEther,
  keccak256,
  toUtf8Bytes,
} from "ethers";
import { demand, sha, id, now } from "./core.mjs";
import {verifyWalletTransaction} from './wallet-transactions.mjs';
import {chainFor,planChain,nativeName,nativeUrl,IMPLEMENTATION_SLOT} from './chains.mjs';
export const CHAIN = chainFor(196);
const ABI = [
  "function pathCount(address) view returns(uint256)",
  "function pathsRange(address,uint256,uint256) view returns(string[])",
  "function fallbackPath(address) view returns(string)",
  "function putFile(address,string,string,bytes32,bytes)",
  "function appendChunk(address,string,uint256,bytes)",
  "function removeFile(address,string)",
  "function setFallback(address,string)",
  "function fileInfo(address,string) view returns(uint32,string,bytes32,uint40,uint256)",
  "function readRange(address,string,uint256,uint256) view returns(bytes)",
];
const BINDING_ABI = [
  "function paidUntil(bytes32,address) view returns(uint40)",
  "function monthlyFee() view returns(uint256)",
  "function bind(string,address,uint256) payable",
  "function isLive(string,address) view returns(bool)",
  "function isContainerLive(address) view returns(bool)",
  "function containerPaidUntil(address) view returns(uint256)",
];
// Removals go last: until the new files and fallback are written, the previous
// release keeps every path it references.
export function registrySteps(container, files, chain = CHAIN, removed = []) {
  const iface = new Interface(ABI),
    steps = [];
  for (const file of files) {
    const bytes = Buffer.from(file.base64, "base64");
    for (let i = 0; i < Math.max(1, Math.ceil(bytes.length / 24000)); i++) {
      const chunk = hexlify(bytes.subarray(i * 24000, (i + 1) * 24000));
      const method = i === 0 ? "putFile" : "appendChunk";
      const args =
        i === 0
          ? [container, file.path, file.contentType, "0x" + file.sha256, chunk]
          : [container, file.path, i, chunk];
      steps.push({
        kind: method,
        path: file.path,
        chunk: i,
        to: chain.registry,
        data: iface.encodeFunctionData(method, args),
        value: "0x0",
      });
    }
  }
  steps.push({
    kind: "setFallback",
    to: chain.registry,
    data: iface.encodeFunctionData("setFallback", [container, "index.html"]),
    value: "0x0",
  });
  for (const path of removed)
    steps.push({
      kind: "removeFile",
      path,
      to: chain.registry,
      data: iface.encodeFunctionData("removeFile", [container, path]),
      value: "0x0",
    });
  return steps;
}
const provider = (chain, rpc = chain.rpc) => {
  const request = rpcRequest(rpc);
  request.timeout = 20000;
  return new JsonRpcProvider(request, chain.chainId, {
    staticNetwork: true,
    batchMaxCount: 1,
    cacheTimeout: -1,
  });
};
async function contracts(p, chain) {
  demand(BigInt(await p.send('eth_chainId', [])) === BigInt(chain.chainId), 'RPC 网络不匹配',409);
  for (const key of ['registry','binding']) {
    demand(('0x'+(await p.getStorage(chain[key],IMPLEMENTATION_SLOT)).slice(-40)).toLowerCase()===chain.implementations[key], '上游合约实现已变更，需要重新核查',409);
  }
}
// Bounded checks: both operators must attest the receipt's canonical block and
// safe/finalized height. No background polling; callers can retry pending work.
export async function stableReceipt(providers, chain, hash, receipt) {
  demand(receipt?.blockHash,'交易回执缺少区块哈希',409);
  for (const p of providers) {
    demand(BigInt(await p.send('eth_chainId',[]))===BigInt(chain.chainId),'RPC 网络不匹配',409);
    const [r,b,head,final]=await Promise.all([p.getTransactionReceipt(hash),p.getBlock(receipt.blockNumber),p.getBlockNumber(),p.getBlock(chain.finality)]);
    demand(r&&r.blockHash===receipt.blockHash&&r.blockNumber===receipt.blockNumber&&r.status===receipt.status&&b?.hash===receipt.blockHash,'交易回执发生分歧或重组，请重试',409);
    demand(head-receipt.blockNumber>=chain.confirmations&&final?.number>=receipt.blockNumber,'交易仍待安全确认，请稍后重试',409);
  }
  for(const p of providers)demand((await p.getBlock(receipt.blockNumber))?.hash===receipt.blockHash,'确认期间区块发生重组，请重试',409);
}
async function confirmStable(p,chain,hash,receipt,rpc) {
  const peer=provider(chain,Array.isArray(rpc)?rpc[1]:chain.rpcUrls[1]);
  try {await stableReceipt([p,peer],chain,hash,receipt);} finally {peer.destroy();}
}
const primaryRpc=rpc=>Array.isArray(rpc)?rpc[0]:rpc;
export async function prepareChain(
  store,
  release,
  project,
  from,
  rpc,
) {
  const chain=chainFor(project.chain.chainId??196);
  demand(!release.plan || (!release.plan.completed?.length && !release.plan.pending && !release.plan.signing), "请恢复已有发布计划，不能覆盖已开始的计划",409);
  store.validateRelease(release);
  demand(
    /^\d+$/.test(project.chain.cpuIndex) && /^\d+$/.test(project.chain.tokenId),
    "请先设置处理器编号与芯片 ID",
  );
  demand(
    release.files.every((f) => f.bytes <= 8400000),
    "TapeKit 单文件上限为 8,400,000 字节",
  );
  assertApproved(store,release,"chain");
  const p = provider(chain,primaryRpc(rpc));
  try {
    await contracts(p,chain);
    from = getAddress(from);
    const factory = new Contract(
      chain.factory,
      ["function cpuAt(uint256) view returns(address)"],
      p,
    );
    const cpu = await factory.cpuAt(project.chain.cpuIndex);
    demand(
      (
        await new Contract(
          cpu,
          ["function ownerOf(uint256) view returns(address)"],
          p,
        ).ownerOf(project.chain.tokenId)
      ).toLowerCase() === from.toLowerCase(),
      "当前钱包不是该芯片的持有人",
      403,
    );
    const opener = new Contract(
      chain.opener,
      [
        "function accountOf(address,uint256) view returns(address)",
        "function isOpened(address,uint256) view returns(bool)",
        "function FEE() view returns(uint256)",
      ],
      p,
    );
    const container = await opener.accountOf(cpu, project.chain.tokenId);
    const reg = new Contract(chain.registry, ABI, p),
      steps = [];
    const count = Number(await reg.pathCount(container));
    const prior = store.state.releases
      .filter(
        (r) =>
          r.projectId === project.id &&
          (r.verification?.chainId??196) === chain.chainId &&
          r.verification?.container?.toLowerCase() ===
            container.toLowerCase() &&
          r.chainStatus === "verified",
      )
      .sort((a, b) =>
        b.verification.verifiedAt.localeCompare(a.verification.verifiedAt),
      )[0];
    demand(
      count === 0 || prior,
      "此容器已有文件且不属于本 Demo 发布历史；请使用独立演示容器",
      409,
    );
    if (prior) {
      demand(count === prior.files.length, "链上文件集合发生外部变化", 409);
      await verifyFiles(p, container, prior.files,chain);
    }
    if (!(await opener.isOpened(cpu, project.chain.tokenId)))
      steps.push({
        kind: "open",
        to: chain.opener,
        data: new Interface([
          "function open(address,uint256) payable",
        ]).encodeFunctionData("open", [cpu, project.chain.tokenId]),
        value: hexlify(
          await opener.FEE().then((n) => {
            let s = n.toString(16);
            return "0x" + (s.length % 2 ? "0" : "") + s;
          }),
        ),
      });
    const removed = (prior?.files || [])
      .filter((f) => !release.files.some((x) => x.path === f.path))
      .map((f) => f.path);
    steps.push(...registrySteps(container, release.files, chain, removed));
    const before = prior
      ? prior.files.map((f) => ({
          path: f.path,
          bytes: f.bytes,
          sha256: f.sha256,
          contentType: f.contentType,
          chunks: Math.max(1, Math.ceil(f.bytes / 24000)),
        }))
      : [];
    const fallback = await reg.fallbackPath(container);
    const plan = {
      id: id("plan"),
      targetDigest: digest({chainId:chain.chainId,cpuIndex:project.chain.cpuIndex,tokenId:project.chain.tokenId}),
      chainId: chain.chainId,
      from,
      cpu,
      tokenId: project.chain.tokenId,
      container,
      cpuIndex: project.chain.cpuIndex,
      name: nativeName({...project.chain,chainId:chain.chainId}),
      nativeSymbol:chain.nativeSymbol,
      before,
      fallback,
      createdAt: now(),
      createdBlock: await p.getBlockNumber(),
      expiresAt: Date.now() + 600000,
      manifestHash: release.manifestHash,
      steps,
      completed: [],
      valueNative: formatEther(steps.reduce((n, s) => n + BigInt(s.value), 0n)),
      gasQuote: "每次签署前检查目标状态并估算当前步骤 gas；最终费用由钱包显示",
      nativeUrl: nativeUrl({...project.chain,chainId:chain.chainId}),
    };
    if(chain.chainId===196)plan.valueOKB=plan.valueNative;
    const binding = new Contract(chain.binding,BINDING_ABI,p);
    plan.activationReserveWei = await binding.isLive(plan.name,container) ? "0" : String(await binding.monthlyFee());
    release.plan = plan;
    release.chainStatus = "prepared";
    store.save();
    store.log(
      project.id,
      chain.name+" 发布计划已准备，等待钱包签署",
      "info",
      release.id,
    );
    return plan;
  } finally {
    p.destroy();
  }
}
export async function confirmTransaction(
  store,
  release,
  index,
  hash,
  rpc,
) {
  const plan = release.plan;
  const chain=planChain(plan);
  demand(
    plan && Number.isInteger(index) && plan.steps[index],
    "发布计划不存在",
  );
  const alreadyConfirmed=plan.completed[index]?.hash.toLowerCase()===String(hash).toLowerCase();
  demand(alreadyConfirmed || index === plan.completed.length, "交易顺序不匹配", 409);
  demand(/^0x[0-9a-f]{64}$/i.test(hash), "交易哈希无效");
  const p = provider(chain,primaryRpc(rpc));
  try {
    await contracts(p,chain);
    const [tx, receipt] = await Promise.all([
      p.getTransaction(hash),
      p.getTransactionReceipt(hash),
    ]);
    demand(tx && receipt, "交易仍待确认，请稍后重试", 409);
    await confirmStable(p,chain,hash,receipt,rpc);
    const s = plan.steps[index];
    if(alreadyConfirmed){await verifyWalletTransaction(p,tx,receipt,plan.from,s,chain.chainId);return {confirmed:true,completed:plan.completed.length,alreadyConfirmed:true};}
    demand(!store.state.releases.some(r=>[...(r.transactions||[]),...(r.failedTransactions||[])].some(t=>t.hash.toLowerCase()===hash.toLowerCase())),'此交易已经用于其他发布步骤',409);
    if(plan.createdBlock!==undefined)demand(receipt.blockNumber>=plan.createdBlock,'交易早于本次发布计划',409);
    const envelope=await verifyWalletTransaction(p,tx,receipt,plan.from,s,chain.chainId);
    const baseFees=chain.chainId===8453&&envelope.kind==='direct'?await actualBaseFees(p,hash,receipt):null;
    const gasWei = baseFees?.gasWei ?? (envelope.kind === "direct" ? (receipt.gasPrice == null ? null : receipt.gasUsed * receipt.gasPrice) : chain.chainId!==8453&&envelope.paymaster === "0x0000000000000000000000000000000000000000" ? BigInt(envelope.gasCostWei) : null);
    recordExpense(release,{hash,gasWei,feeBreakdown:baseFees?.feeBreakdown,valueWei:s.value,success:envelope.success,kind:s.kind,block:receipt.blockNumber});
    store.save();
    if (!envelope.success) {
      delete plan.pending;
      delete plan.signing;
      release.failedTransactions ||= [];
      release.failedTransactions.push({
        index,
        hash,
        block: receipt.blockNumber,
      });
      store.save();
      store.log(
        release.projectId,
        "交易执行失败；可重新检查后重试当前步骤",
        "error",
        release.id,
      );
      demand(false, "交易执行失败且已清除待确认状态，请检查原因后重试", 409);
    }
    plan.completed.push({ index, hash, chainId:chain.chainId, blockHash:receipt.blockHash, block: receipt.blockNumber, wallet:envelope.kind });
    delete plan.pending;
    delete plan.signing;
    release.transactions.push({
      hash,
      chainId:chain.chainId,
      blockHash:receipt.blockHash,
      kind: s.kind,
      block: receipt.blockNumber,
    });
    release.chainStatus = ["bind30Days","bindDomain"].includes(s.kind) ? "verified" : "publishing";
    if (s.kind === "bindDomain") {
      const domain=store.state.domains.find(d=>d.id===s.domainId && d.projectId===release.projectId);
      demand(domain?.chainBinding?.planId===plan.id,"域名绑定计划不匹配",409);
      domain.chainBinding.status="confirmed";domain.chainBinding.transactionHash=hash;domain.status="pending";
    }
    if (s.kind === "bind30Days") {
      const binding = new Contract(chain.binding, BINDING_ABI, p);
      demand(
        await binding.isLive(plan.name, plan.container),
        "激活状态未确认",
        409,
      );
      release.activation = {
        live: true,
        url: plan.nativeUrl,
        paidUntil: String(await binding.containerPaidUntil(plan.container)),
        checkedAt: now(),
      };
      release.receipt = store.receiptFor(release, "chain-file-verification");
    }
    store.save();
    store.log(
      release.projectId,
      "已确认 " + s.kind + " · " + hash.slice(0, 12),
      "success",
      release.id,
    );
    return { confirmed: true, completed: plan.completed.length };
  } catch (error) {
    if (Number.isInteger(error?.status)) throw error;
    throw Object.assign(new Error('确认 RPC 暂不可用或访问受限；交易仍待确认，请稍后重试，不要重复签署'), {status:503});
  } finally {
    p.destroy();
  }
}
async function verifyFiles(p, container, files,chain,blockTag) {
  const block = blockTag ?? await p.getBlockNumber(),
    reg = new Contract(chain.registry, ABI, p);
  const beforeBlock=await p.getBlock(block);
  demand(beforeBlock?.hash,"区块不可读取",409);
  demand(
    Number(await reg.pathCount(container, { blockTag: block })) ===
      files.length,
    "链上文件集合不一致",
    409,
  );
  for (const file of files) {
    const info = await reg.fileInfo(container, file.path, { blockTag: block });
    demand(
      Number(info[0]) === file.bytes &&
        info[1] === file.contentType &&
        Number(info[4]) === Math.max(1, Math.ceil(file.bytes / 24000)) &&
        info[2].slice(2).toLowerCase() === file.sha256,
      "链上文件元数据不符：" + file.path,
      409,
    );
    const chunks = [];
    for (let offset = 0; offset < file.bytes; offset += 24000)
      chunks.push(
        Buffer.from(
          (
            await reg.readRange(
              container,
              file.path,
              offset,
              Math.min(24000, file.bytes - offset),
              { blockTag: block },
            )
          ).slice(2),
          "hex",
        ),
      );
    demand(
      sha(Buffer.concat(chunks)) === file.sha256,
      "链上文件哈希不符：" + file.path,
      409,
    );
  }
  const b = await p.getBlock(block);
  demand(b?.hash===beforeBlock.hash,"读回期间区块发生重组，请重试",409);
  return {
    chainId: chain.chainId,
    store: chain.registry,
    container,
    block: block,
    blockHash: b.hash,
    verifiedAt: now(),
  };
}
export async function readback(store, release, rpc) {
  demand(
    release.plan && release.plan.completed.length === release.plan.steps.length,
    "请先确认全部交易",
    409,
  );
  const chain=planChain(release.plan);
  const p = provider(chain,primaryRpc(rpc));
  try {
    await contracts(p,chain);
    store.validateRelease(release);
    const verification = await verifyFiles(
      p,
      release.plan.container,
      release.files,
      chain,
    );
    demand(
      (await new Contract(chain.registry, ABI, p).fallbackPath(
        release.plan.container,
        { blockTag: verification.block },
      )) === "index.html",
      "链上回退入口不一致",
      409,
    );
    const peer=provider(chain,Array.isArray(rpc)?rpc[1]:chain.rpcUrls[1]);
    try {
      await contracts(peer,chain);
      const second=await verifyFiles(peer,release.plan.container,release.files,chain,verification.block);
      demand(second.blockHash===verification.blockHash,'两个 RPC 的区块哈希不一致',409);
      demand(await new Contract(chain.registry,ABI,peer).fallbackPath(release.plan.container,{blockTag:verification.block})==='index.html','链上回退入口不一致',409);
      demand((await p.getBlock(verification.block))?.hash===verification.blockHash,'读回期间区块发生重组，请重试',409);
    } finally {peer.destroy();}
    release.verification = verification;
    release.chainStatus = "verified";
    release.receipt = store.receiptFor(release, "chain-file-verification");
    store.save();
    store.log(
      release.projectId,
      chain.name+" 全部文件已读回核验；域名激活另行检查",
      "success",
      release.id,
    );
    return verification;
  } finally {
    p.destroy();
  }
}

// Checks the expected partial state before each new signature. RPC override is
// an internal test seam; HTTP clients cannot select arbitrary RPC destinations.
export async function preflightStep(store, release, rpc) {
  const plan = release.plan;
  const chain=planChain(plan);
  demand(plan, "请先生成发布计划", 409);
  assertApproved(store,release,"chain");
  assertPlanTarget(store,release);
  store.validateRelease(release);
  demand(plan.manifestHash === release.manifestHash, "发布清单已变化", 409);
  demand(
    !plan.pending && !plan.signing,
    "已有待确认或结果未知的签署，请先恢复该步骤",
    409,
  );
  const step = plan.steps[plan.completed.length];
  demand(step, "全部步骤已完成", 409);
  demand(
    plan.completed.length > 0 || plan.expiresAt > Date.now(),
    "计划已过期，请重新生成",
    409,
  );
  const p = provider(chain,primaryRpc(rpc));
  try {
    await contracts(p,chain);
    const nft = new Contract(
      plan.cpu,
      ["function ownerOf(uint256) view returns(address)"],
      p,
    );
    demand(
      (await nft.ownerOf(plan.tokenId)).toLowerCase() ===
        plan.from.toLowerCase(),
      "芯片所有权已变化，停止发布",
      409,
    );
    const expected = new Map(plan.before.map((f) => [f.path, { ...f }]));
    let fallback = plan.fallback;
    for (const completed of plan.completed) {
      const s = plan.steps[completed.index],
        f = release.files.find((f) => f.path === s.path);
      if (s.kind === "removeFile") expected.delete(s.path);
      if (s.kind === "putFile")
        expected.set(s.path, {
          ...f,
          bytes: Math.min(f.bytes, 24000),
          chunks: 1,
        });
      if (s.kind === "appendChunk") {
        const value = expected.get(s.path);
        value.bytes = Math.min(f.bytes, (s.chunk + 1) * 24000);
        value.chunks = s.chunk + 1;
      }
      if (s.kind === "setFallback") fallback = "index.html";
    }
    const reg = new Contract(chain.registry, ABI, p),
      block = await p.getBlockNumber();
    demand(
      Number(await reg.pathCount(plan.container, { blockTag: block })) ===
        expected.size,
      "容器被外部改动，停止发布",
      409,
    );
    for (const [name, f] of expected) {
      const info = await reg.fileInfo(plan.container, name, {
        blockTag: block,
      });
      demand(
        Number(info[0]) === f.bytes &&
          info[1] === f.contentType &&
          info[2].slice(2).toLowerCase() === f.sha256 &&
          Number(info[4]) === f.chunks,
        "文件状态发生外部变化：" + name,
        409,
      );
    }
    demand(
      (await reg.fallbackPath(plan.container, { blockTag: block })) ===
        fallback,
      "回退入口被外部改动",
      409,
    );
    if (["bind30Days","bindDomain"].includes(step.kind)) {
      await verifyFiles(p, plan.container, release.files,chain);
      demand(
        (await new Contract(chain.binding, BINDING_ABI, p).monthlyFee()) * BigInt(step.months||1) ===
          BigInt(step.value),
        "激活价格已变更，请刷新计划",
        409,
      );
    }
    const tx = {
        from: plan.from,
        to: step.to,
        data: step.data,
        value: BigInt(step.value),
      },
      gas = await p.estimateGas(tx),
      fee = await p.getFeeData();
    const baseFees=chain.chainId===8453?await estimateBaseFees(p,step,gas*13n/10n+20000n):{};
    return quoteStep(store,release,{gas,gasPrice:fee.gasPrice||0n,balance:await p.getBalance(plan.from),walletCode:await p.getCode(plan.from),...baseFees});
  } finally {
    p.destroy();
  }
}

export async function revalidateBaseQuote(release) {
  if(!release.plan||planChain(release.plan).chainId!==8453)return;
  const q=release.plan.quote;demand(q&&q.expiresAt>Date.now(),'Base 报价已过期，请重新估价',409);
  const p=provider(planChain(release.plan));
  try{
    const current=await estimateBaseFees(p,release.plan.steps[q.index],BigInt(q.transaction.gas));
    demand(current.l1FeeWei+current.operatorFeeWei<=BigInt(q.intrinsicReserveWei),'Base 数据费已超过预留，请重新估价',409);
  }finally{p.destroy();}
}

export async function prepareActivation(store, release, rpc) {
  demand(
    release.chainStatus === "verified" && release.plan,
    "先完成链上文件读回验证",
    409,
  );
  const plan = release.plan;
  const chain=planChain(plan);
  demand(!plan.pending && !plan.signing, "请先恢复待确认交易", 409);
  const p = provider(chain,primaryRpc(rpc));
  try {
    await contracts(p,chain);
    await verifyFiles(p, plan.container, release.files,chain);
    const binding = new Contract(chain.binding, BINDING_ABI, p);
    if (await binding.isLive(plan.name, plan.container)) {
      release.activation = {
        live: true,
        url: plan.nativeUrl,
        paidUntil: String(await binding.containerPaidUntil(plan.container)),
        checkedAt: now(),
      };
      store.save();
      return plan;
    }
    if (
      plan.steps.at(-1)?.kind === "bind30Days" &&
      plan.completed.length === plan.steps.length - 1
    )
      plan.steps.pop();
    demand(
      plan.completed.length === plan.steps.length,
      "请先完成已有计划",
      409,
    );
    assertApproved(store,release,"chain");
    assertPlanTarget(store,release);
    const fee = await binding.monthlyFee();
    delete plan.quote;
    plan.activationReserveWei="0";
    plan.steps.push({
      kind: "bind30Days",
      to: chain.binding,
      data: new Interface(BINDING_ABI).encodeFunctionData("bind", [
        plan.name,
        plan.container,
        1,
      ]),
      value: String(fee),
    });
    plan.valueNative = formatEther(
      plan.steps.reduce((n, s) => n + BigInt(s.value), 0n),
    );
    if(chain.chainId===196)plan.valueOKB=plan.valueNative;
    store.save();
    return plan;
  } finally {
    p.destroy();
  }
}

// Re-read recorded receipts after an upgrade or interrupted confirmation. This
// never sends a transaction or treats a paymaster's fee as the user's zero cost.
export async function reconcileExpenses(store,release,rpc) {
  demand(release.plan,'此版本没有可核验的链上发布计划',409);
  const chain=planChain(release.plan);
  const p=provider(chain,primaryRpc(rpc));
  try {
    await contracts(p,chain);
    const rows=[...(release.transactions||[]),...(release.failedTransactions||[])];
    for(const item of rows){
      const completed=release.plan.completed.find(c=>c.hash.toLowerCase()===item.hash.toLowerCase());
      const index=completed?.index??item.index,step=release.plan.steps[index];
      demand(step,'历史步骤资料不足，无法自动核定费用',409);
      const [tx,receipt]=await Promise.all([p.getTransaction(item.hash),p.getTransactionReceipt(item.hash)]);
      demand(tx&&receipt,'历史交易回执暂不可读取，请稍后重试',409);
      await confirmStable(p,chain,item.hash,receipt,rpc);
      const envelope=await verifyWalletTransaction(p,tx,receipt,release.plan.from,step,chain.chainId);
      const baseFees=chain.chainId===8453&&envelope.kind==='direct'?await actualBaseFees(p,item.hash,receipt):null;
      const gasWei=baseFees?.gasWei??(envelope.kind==='direct'?(receipt.gasPrice==null?null:receipt.gasUsed*receipt.gasPrice):chain.chainId!==8453&&envelope.paymaster==='0x0000000000000000000000000000000000000000'?BigInt(envelope.gasCostWei):null);
      recordExpense(release,{hash:item.hash,gasWei,feeBreakdown:baseFees?.feeBreakdown,valueWei:step.value,success:envelope.success,kind:step.kind,block:receipt.blockNumber});
      store.save();
    }
    return {checked:rows.length};
  } finally {p.destroy();}
}

export async function prepareDomainBinding(store,release,domain,rpc) {
  const plan=release.plan,chain=planChain(plan);
  demand(chain.chainId===56,'HashPort 自定义域名仅支持 BSC',409);
  demand(plan&&release.chainStatus==='verified'&&plan.completed.length===plan.steps.length&&!plan.pending&&!plan.signing,'先完成链上文件发布与核验',409);
  demand(domain.projectId===release.projectId,'域名不属于此项目',409);
  demand(/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/.test(domain.hostname)&&domain.hostname.length<=253,'域名无效');
  assertApproved(store,release,'chain');assertPlanTarget(store,release);store.validateRelease(release);
  const p=provider(chain,primaryRpc(rpc));try {
    await contracts(p,chain);await verifyFiles(p,plan.container,release.files,chain);
    const binding=new Contract(chain.binding,BINDING_ABI,p),fee=await binding.monthlyFee();
    const until=await binding.paidUntil(keccak256(toUtf8Bytes(domain.hostname)),plan.container),block=await p.getBlock('latest');
    const months=fee===0n?Math.max(0,Math.min(120,Math.floor((Number(block.timestamp)+120*30*86400-Math.max(Number(until),Number(block.timestamp)))/(30*86400)))):1;
    const target={chainId:chain.chainId,name:domain.hostname,container:plan.container,releaseId:release.id,planId:plan.id,manifestHash:release.manifestHash,status:'pending',feeWei:String(fee*BigInt(months)),months};
    if(months===0){demand(await binding.isLive(domain.hostname,plan.container),'域名到期状态不一致',409);domain.chainBinding={...target,status:'confirmed'};store.save();return {plan,binding:domain.chainBinding};}
    const step={kind:'bindDomain',domainId:domain.id,name:domain.hostname,months,to:chain.binding,value:String(fee*BigInt(months)),data:new Interface(BINDING_ABI).encodeFunctionData('bind',[domain.hostname,plan.container,months])};
    await p.call({from:plan.from,to:step.to,data:step.data,value:BigInt(step.value)});
    delete plan.quote;plan.steps.push(step);domain.chainBinding=target;domain.status='pending';
    plan.valueNative=formatEther(plan.steps.reduce((n,s)=>n+BigInt(s.value),0n));store.save();return {plan,binding:target};
  }finally{p.destroy();}
}
export async function checkDomainBinding(target,rpc) {
  const chain=chainFor(target.chainId);demand(chain.chainId===56,'HashPort 自定义域名仅支持 BSC',409);
  const providers=[provider(chain,primaryRpc(rpc)),provider(chain,Array.isArray(rpc)?rpc[1]:chain.rpcUrls[1])];
  try{const values=[];for(const p of providers){await contracts(p,chain);const binding=new Contract(chain.binding,BINDING_ABI,p);const [live,until]=await Promise.all([binding.isLive(target.name,target.container),binding.paidUntil(keccak256(toUtf8Bytes(target.name)),target.container)]);values.push({live,paidUntil:String(until)});}
    demand(values.every(v=>v.live&&BigInt(v.paidUntil)*1000n>BigInt(Date.now()))&&values[0].paidUntil===values[1].paidUntil,'域名链上绑定尚未生效或 RPC 不一致',409);return values[0];
  }finally{providers.forEach(p=>p.destroy());}
}
