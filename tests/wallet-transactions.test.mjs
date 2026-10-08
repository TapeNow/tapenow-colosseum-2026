import test from 'node:test';import assert from 'node:assert/strict';
import {AbiCoder,ZeroAddress,ZeroHash} from 'ethers';
import {decodeApprovedOperation,entryInterface,operationHash,OKX_ENTRY,verifyWalletTransaction} from '../server/wallet-transactions.mjs';
const coder=AbiCoder.defaultAbiCoder(),sender='0x1111111111111111111111111111111111111111',step={to:'0x2222222222222222222222222222222222222222',value:'42',data:'0x12345678'};
function fixture({calls=[{target:step.to,value:42n,data:step.data}],success=true,opOverrides={}}={}){
 const op={sender,nonce:7n,initCode:'0x',callData:'0x8dd7712f'+coder.encode(['tuple(address target,uint256 value,bytes data)[]'],[calls]).slice(2),accountGasLimits:ZeroHash,preVerificationGas:100n,gasFees:ZeroHash,paymasterAndData:'0x',signature:'0x12',...opOverrides};
 const event=entryInterface.encodeEventLog(entryInterface.getEvent('UserOperationEvent'),[operationHash(op),op.sender,ZeroAddress,op.nonce,success,0n,500n]);
 return {tx:{chainId:196n,from:ZeroAddress,to:OKX_ENTRY,value:0n,data:entryInterface.encodeFunctionData('handleOps',[[op],ZeroAddress])},receipt:{status:1,blockNumber:100,logs:[{address:OKX_ENTRY,...event}]}};
}
test('direct transactions and exact successful OKX calls are distinguished from a failed UserOperation',()=>{
 assert.equal(decodeApprovedOperation({chainId:196,from:sender,to:step.to,data:step.data,value:42}, {status:1},sender,step).kind,'direct');
 const f=fixture();assert.equal(decodeApprovedOperation(f.tx,f.receipt,sender,step).success,true);
 const failed=fixture({success:false});assert.equal(decodeApprovedOperation(failed.tx,failed.receipt,sender,step).success,false);
});
test('AA extra calls, wrong value / calldata / sender / event / chain and unknown implementations fail closed',async()=>{
 for(const opts of [{calls:[{target:step.to,value:42,data:step.data},{target:sender,value:5,data:'0x'}]},{calls:[{target:step.to,value:43,data:step.data}]},{calls:[{target:step.to,value:42,data:'0xdeadbeef'}]},{opOverrides:{sender:ZeroAddress}},{opOverrides:{initCode:'0x7702'}}]){const f=fixture(opts);assert.throws(()=>decodeApprovedOperation(f.tx,f.receipt,sender,step));}
 const f=fixture();assert.throws(()=>decodeApprovedOperation({...f.tx,chainId:1},f.receipt,sender,step));
 assert.throws(()=>decodeApprovedOperation(f.tx,{...f.receipt,logs:[]},sender,step));
 const wrong=fixture({opOverrides:{nonce:8}});assert.throws(()=>decodeApprovedOperation(f.tx,wrong.receipt,sender,step));
 await assert.rejects(verifyWalletTransaction({getCode:async()=> '0x'},f.tx,f.receipt,sender,step),/实现发生变化/);
});
