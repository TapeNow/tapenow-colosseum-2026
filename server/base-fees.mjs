import {Contract} from 'ethers';
import {demand} from './core.mjs';

// Base GasPriceOracle: estimates include L1 data and any operator charge.
// These intrinsic charges cannot be capped by a wallet's maxFeePerGas.
export const BASE_GAS_ORACLE='0x420000000000000000000000000000000000000F';
const ABI=['function getL1FeeUpperBound(uint256) view returns(uint256)','function getOperatorFee(uint256) view returns(uint256)'];
export async function estimateBaseFees(provider,step,gasLimit) {
  const oracle=new Contract(BASE_GAS_ORACLE,ABI,provider);
  // Legacy signed envelope overhead, with room for maximal nonce/signature RLP.
  const txSize=(step.data.length-2)/2+512;
  const [l1FeeWei,operatorFeeWei]=await Promise.all([oracle.getL1FeeUpperBound(txSize),oracle.getOperatorFee(gasLimit)]);
  demand(l1FeeWei>0n&&operatorFeeWei>=0n,'Base 数据费报价不可用，停止签署',503);
  return {l1FeeWei,operatorFeeWei};
}
export function receiptBaseFees(raw,receipt,operatorFeeWei) {
  demand(raw?.blockHash===receipt.blockHash&&raw.transactionHash?.toLowerCase()===receipt.hash.toLowerCase(),'Base 费用回执与交易不匹配',503);
  demand(typeof raw.l1Fee==='string'&&/^0x[0-9a-f]+$/i.test(raw.l1Fee)&&receipt.gasPrice!=null&&typeof operatorFeeWei==='bigint'&&operatorFeeWei>=0n,'Base 回执缺少完整数据费，保留待确认交易',503);
  const executionWei=receipt.gasUsed*receipt.gasPrice,l1Wei=BigInt(raw.l1Fee);
  return {gasWei:executionWei+l1Wei+operatorFeeWei,feeBreakdown:{executionWei:String(executionWei),l1Wei:String(l1Wei),operatorWei:String(operatorFeeWei)}};
}
export async function actualBaseFees(provider,hash,receipt) {
  const [raw,operatorFee]=await Promise.all([provider.send('eth_getTransactionReceipt',[hash]),new Contract(BASE_GAS_ORACLE,ABI,provider).getOperatorFee(receipt.gasUsed,{blockTag:receipt.blockNumber})]);
  return receiptBaseFees(raw,receipt,operatorFee);
}
