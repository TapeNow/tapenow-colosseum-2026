export const networks:Record<number,{name:string;symbol:string;rpc:string;explorer:string}>={
  56:{name:'BNB Smart Chain',symbol:'BNB',rpc:'https://bsc-dataseed.bnbchain.org',explorer:'https://bscscan.com'},
  196:{name:'X Layer',symbol:'OKB',rpc:'https://rpc.xlayer.tech',explorer:'https://www.oklink.com/xlayer'},
  8453:{name:'Base',symbol:'ETH',rpc:'https://base.gateway.tenderly.co',explorer:'https://basescan.org'},
};
export const network=(id:number)=>{const value=networks[id];if(!value)throw new Error('Unsupported chain');return value;};
