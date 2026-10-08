import {AbiCoder,Interface,keccak256} from 'ethers';
import {chainFor} from './chains.mjs';
import {demand} from './core.mjs';
// Strict adapter for the documented OKX v0.7 / EIP-7702 implementation.
// Source: okxlabs/okx-smart-wallet-evm@be890c49aee80b96b910b6dd13f47b24f16f04f0
export const OKX_ENTRY='0x0000000071727de22e5e9d8baf0edac6f37da032';
export const OKX_IMPL='0xe40ccb2d94975c51bff0c004efdfd9b3a5796fa4';
export const OKX_RUNTIME_HASH='0xef2c339869b7f98f617866a7d78423c05e5f46795cce5dee5c9d3b91ca8733b0';
const abi=AbiCoder.defaultAbiCoder();
export const entryInterface=new Interface([
 'function handleOps((address sender,uint256 nonce,bytes initCode,bytes callData,bytes32 accountGasLimits,uint256 preVerificationGas,bytes32 gasFees,bytes paymasterAndData,bytes signature)[] ops,address beneficiary)',
 'event UserOperationEvent(bytes32 indexed userOpHash,address indexed sender,address indexed paymaster,uint256 nonce,bool success,uint256 actualGasCost,uint256 actualGasUsed)'
]);
export function operationHash(op,chainId=196){
 chainId=chainFor(chainId).chainId;
 const inner=keccak256(abi.encode(['address','uint256','bytes32','bytes32','bytes32','uint256','bytes32','bytes32'],[op.sender,op.nonce,keccak256(op.initCode),keccak256(op.callData),op.accountGasLimits,op.preVerificationGas,op.gasFees,keccak256(op.paymasterAndData)]));
 return keccak256(abi.encode(['bytes32','address','uint256'],[inner,OKX_ENTRY,chainId]));
}
const matches=(call,step)=>call.target?.toLowerCase()===step.to.toLowerCase()&&call.data.toLowerCase()===step.data.toLowerCase()&&BigInt(call.value)===BigInt(step.value);
export function decodeApprovedOperation(tx,receipt,from,step,chainId=196){
 demand(BigInt(tx.chainId)===BigInt(chainFor(chainId).chainId),'交易网络不匹配',409);
 if(tx.from.toLowerCase()===from.toLowerCase() && matches({target:tx.to,data:tx.data,value:tx.value},step))return {kind:'direct',success:receipt.status===1};
 demand(tx.to?.toLowerCase()===OKX_ENTRY&&BigInt(tx.value)===0n,'交易与批准的步骤不一致',409);
 let parsed,calls;try{parsed=entryInterface.parseTransaction({data:tx.data});}catch{}
 demand(parsed?.name==='handleOps','尚不支持此智能钱包交易格式',409);
 // Only one op and one exact call: no implicit fee transfers, upgrades or unrelated calls.
 demand(parsed.args.ops.length===1,'只接受单步骤智能钱包交易',409);const op=parsed.args.ops[0];
 demand(op.sender.toLowerCase()===from.toLowerCase()&&op.initCode==='0x'&&op.callData.slice(0,10).toLowerCase()==='0x8dd7712f','智能钱包发送方或调用格式不匹配',409);
 const encoded='0x'+op.callData.slice(10);
 try{[calls]=abi.decode(['tuple(address target,uint256 value,bytes data)[]'],encoded);}catch{}
 demand(calls?.length===1&&abi.encode(['tuple(address target,uint256 value,bytes data)[]'],[calls]).toLowerCase()===encoded.toLowerCase()&&matches(calls[0],step),'智能钱包内部调用与批准步骤不一致',409);
 const events=receipt.logs.filter(log=>log.address.toLowerCase()===OKX_ENTRY).map(log=>{try{return entryInterface.parseLog(log);}catch{return null;}}).filter(log=>log?.name==='UserOperationEvent');
 demand(events.length===1,'智能钱包回执事件不唯一',409);const event=events[0].args;
 demand(event.sender.toLowerCase()===from.toLowerCase()&&event.nonce===op.nonce&&event.userOpHash.toLowerCase()===operationHash(op,chainId).toLowerCase(),'智能钱包回执与调用不匹配',409);
 return {kind:'okx-7702',success:receipt.status===1&&event.success,gasCostWei:String(event.actualGasCost),paymaster:event.paymaster.toLowerCase(),userOpHash:event.userOpHash};
}
export async function verifyWalletTransaction(provider,tx,receipt,from,step,chainId=196){
 const envelope=decodeApprovedOperation(tx,receipt,from,step,chainId);
 if(envelope.kind==='okx-7702'){
  const [wallet,implementation]=await Promise.all([provider.getCode(from,receipt.blockNumber),provider.getCode(OKX_IMPL,receipt.blockNumber)]);
  demand(wallet.toLowerCase()==='0xef0100'+OKX_IMPL.slice(2)&&keccak256(implementation)===OKX_RUNTIME_HASH,'智能钱包实现发生变化，需要重新核查',409);
 }
 return envelope;
}
