// TapeKit kernel/src/config.js: explicit per-chain deployment pins.
export const IMPLEMENTATION_SLOT='0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc';
const config = value => Object.freeze({...value,rpc:value.rpcUrls[0],rpcUrls:Object.freeze(value.rpcUrls),implementations:Object.freeze(value.implementations)});
export const CHAINS=Object.freeze({
  56:config({chainId:56,name:'BNB Smart Chain',nativeSymbol:'BNB',currency:'BNB',area:null,finality:'finalized',confirmations:6,
    // Independent operators: NodeReal and BlastAPI (Alchemy). PublicNode gates historical receipts.
    rpcUrls:['https://bsc-dataseed.bnbchain.org','https://bsc-mainnet.public.blastapi.io'],
    factory:'0x68224f668083c29e9800be2a646d42d18cedf7e2',opener:'0x021745de2f42a7839d96f2d3634d0294487d81f1',registry:'0xd006ffdd5ae313b17729621a00999cd3c71ce5e6',binding:'0x861ee183de2bbe4a6ecf9d15812c123b566a3db7',
    implementations:{registry:'0x1d279d138a4d803378a7d4557c056f1bed53c261',binding:'0xaa226181a6588d3f9ac0035e5f3dbaf311039bce'}}),
  196:config({chainId:196,name:'X Layer',nativeSymbol:'OKB',currency:'OKB',area:2,finality:'safe',confirmations:6,
    rpcUrls:['https://rpc.xlayer.tech','https://xlayer.drpc.org'],
    factory:'0x1f09daefa827f02cbb40967cc91b259763760761',opener:'0x536add8f30f03b69f6fbf29d425a816a0dc50106',registry:'0xd6efb7adcc9c83dc4924ad56f6a8e4e969b9adb6',binding:'0x68809fd2fb343aa57d0aeb7f33defe477c9666f9',
    implementations:{registry:'0xa85c4143d1d4a77f54b8e4ecc9e6d1418afea45f',binding:'0x5ebf29b80789e548907c707530c3c7607c4347df'}}),
  // Independent operators: Tenderly and BlastAPI (Alchemy), including historical reads.
  8453:config({chainId:8453,name:'Base',nativeSymbol:'ETH',currency:'ETH',area:3,finality:'safe',confirmations:6,
    rpcUrls:['https://base.gateway.tenderly.co','https://base-mainnet.public.blastapi.io'],
    factory:'0x1f09daefa827f02cbb40967cc91b259763760761',opener:'0x536add8f30f03b69f6fbf29d425a816a0dc50106',registry:'0xd6efb7adcc9c83dc4924ad56f6a8e4e969b9adb6',binding:'0x68809fd2fb343aa57d0aeb7f33defe477c9666f9',
    implementations:{registry:'0xa85c4143d1d4a77f54b8e4ecc9e6d1418afea45f',binding:'0x5ebf29b80789e548907c707530c3c7607c4347df'}}),
});
export function chainFor(value=196){
  const chain=CHAINS[Number(value)];
  if(!chain)throw Object.assign(new Error('不支持的发布网络'),{status:409});
  return chain;
}
// Missing chain IDs belong to historical X Layer records, never the current project.
export const planChain=plan=>chainFor(plan?.chainId??196);
export function nativeName(target){const c=chainFor(target.chainId??196);return [target.tokenId,c.area,target.cpuIndex,'tape'].filter(x=>x!==null).join('.');}
export const nativeUrl=target=>'https://'+nativeName(target).replace(/\.tape$/,'').replaceAll('.','-')+'.tapekit.org/';
