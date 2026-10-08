export type GatewaySite = {status:string;stableUrl:string;versionUrl:string;manifestUrl:string;versionId:string};
export type Project = {
  gateway?: GatewaySite;
  role?: "owner" | "publisher" | "viewer";
  id: string;
  name: string;
  description: string;
  createdAt: string;
  updatedAt: string;
  productionId: string | null;
  databaseVersion?: string;
  chain: {
    chainId: number;
    cpuIndex: string;
    tokenId: string;
    container: string;
  };
  environment: Env[];
  repository: string | null;
};
export type Env = {
  stage?: "build" | "runtime";
  id: string;
  key: string;
  value: string;
  secret: boolean;
  environment: string;
  updatedAt: string;
};
export type FileMeta = {
  path: string;
  bytes: number;
  sha256: string;
  contentType: string;
};
export type Release = {
  nativeAccess?: {status:string;url:string;scope?:string;observedAt?:string};
  gateway?: GatewaySite;
  archive?: {state:string;pinned?:boolean};
  publicExposure?: {kind:string;at:string};
  privatePreview?: {status:string;url:string;expiresAt:string};
  databaseContract?: {usesDatabase:boolean;versions:string[]};
  workflow?: {status:string;next:string;intent:string;steps:{key:string;label:string;status:string}[]};
  id: string;
  projectId: string;
  label: string;
  createdAt: string;
  source: { type: string; commit?: string; repository?: string };
  status: string;
  environment: string;
  chainStatus: string;
  manifestHash: string;
  bytes: number;
  files: FileMeta[];
  checks: { label: string; status: string }[];
  activation?: { live: boolean; url: string; paidUntil: string };
  cloudflareProduction?: { url: string; status: string; projectName: string; error?: string };
  cloudflare: null | { url: string; status: string; projectName: string; error?: string };
  transactions: { hash: string; kind: string; block: number }[];
  restoredFrom?: string;
  preview?: {url?:string;status:string;error?:string};
  site?: {url:string;stableUrl:string;status:string;manifestHash:string;at:string};
  verification?: Record<string, unknown>;
};
export type Connection = {
  authMethod?: "manual" | "oauth";
  grantId?: string;
  provider: string;
  projectId: string;
  environment: string;
  status: string;
  checkedAt: string;
  label: string;
  detail: string;
};
export type Log = {
  id: string;
  projectId: string;
  releaseId: string | null;
  message: string;
  level: string;
  at: string;
};
export type Domain = {
  provider?: "pages" | "hashport" | "gateway";
  id: string;
  projectId: string;
  hostname: string;
  status: string;
  detail: string;
  target?: string;
};
export type State = {
  preferences?: {onboardingDismissed?:boolean};
  projects: Project[];
  releases: Release[];
  connections: Record<string, Connection>;
  logs: Log[];
  domains: Domain[];
  visits: { projectId: string; releaseId: string; at: string }[];
};
export type Plan = {
  id: string;
  chainId: number;
  from: string;
  container: string;
  expiresAt: number;
  steps: {
    kind: string;
    path?: string;
    to: string;
    data: string;
    value: string;
  }[];
  completed: { index: number; hash: string }[];
  signing?: { index: number; startedAt: string };
  pending?: { index: number; hash: string };
  valueOKB?: string;
  valueNative: string;
  nativeSymbol: string;
  gasQuote: string;
  nativeUrl: string;
};
declare global {
  interface Window {
    ethereum?: {
      request: (args: { method: string; params?: unknown[] }) => Promise<any>;
    };
    okxwallet?: {
      request: (args: { method: string; params?: unknown[] }) => Promise<any>;
    };
  }
}
