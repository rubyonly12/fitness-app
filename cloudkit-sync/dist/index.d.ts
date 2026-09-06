export interface CloudKitSaveOptions { value: string; }
export interface CloudKitFetchResult { value: string; }
export interface CloudKitAvailableResult { available: boolean; }

export function save(options: CloudKitSaveOptions): Promise<void>;
export function fetch(): Promise<CloudKitFetchResult>;
export function isAvailable(): Promise<CloudKitAvailableResult>;
