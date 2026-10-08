export function pagesPublicPath(path: string): string;
export function verifyPagesManifest(url: string, plan: {files: {path:string;sha256:string}[];removed:string[]}, options?: {fetchImpl?:typeof fetch;pause?:(ms:number)=>Promise<void>}): Promise<{filesChecked:number;removedChecked:number;failed:{path:string;removed:boolean}[];at:string}>;
