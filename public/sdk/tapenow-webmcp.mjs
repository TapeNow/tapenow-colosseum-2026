// A same-document helper, not a remote MCP endpoint. Never polyfills WebMCP.
const modes=new WeakMap();
const decode=result=>typeof result==='string'?JSON.parse(result):result;
export async function discover(context=globalThis.document?.modelContext){
  if(!context?.getTools||!context?.executeTool)throw Error('Native WebMCP unavailable');
  const origin=globalThis.location?.origin;
  return (await context.getTools()).filter(tool=>tool.name.startsWith('tapenow_')&&(!origin||tool.origin===origin));
}
export async function call(name,args={},context=globalThis.document?.modelContext){
  const tools=await discover(context),tool=tools.find(t=>t.name===name),probe=tools.find(t=>t.name==='tapenow_context');
  if(!tool||!probe)throw Error('Sign in and rediscover current TapeNow tools');
  let mode=modes.get(context),initial;
  if(!mode){
    // Detect on a read-only call. Never retry a consequential operation merely
    // because a browser version uses a different argument representation.
    try{initial=decode(await context.executeTool(probe,{}));mode='object';}
    catch(error){if(!/parse input arguments/i.test(String(error.message)))throw error;initial=decode(await context.executeTool(probe,'{}'));mode='json';}
    modes.set(context,mode);
    if(name==='tapenow_context'&&Object.keys(args).length===0)return initial;
  }
  return decode(await context.executeTool(tool,mode==='json'?JSON.stringify(args):args));
}
