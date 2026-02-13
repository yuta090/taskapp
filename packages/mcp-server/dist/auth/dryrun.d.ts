/**
 * Dry Run / Confirm Module
 *
 * 破壊的操作の2段階確認を提供
 */
import type { AuthContext } from './authorize.js';
export interface DryRunResult {
    success: boolean;
    dryRun: true;
    affectedCount: number;
    resourceType: string;
    resourceIds: string[];
    confirmToken: string;
    expiresInSeconds: number;
    message: string;
    error?: string;
}
export interface ConfirmResult {
    success: boolean;
    deletedCount?: number;
    resourceType?: string;
    error?: string;
}
/**
 * 削除のdry runを実行
 * 実際には削除せず、影響件数と確認トークンを返す
 */
export declare function dryRunDelete(params: {
    ctx: AuthContext;
    spaceId: string;
    resourceType: string;
    resourceIds: string[];
}): Promise<DryRunResult>;
/**
 * 確認トークンを使用して実際の削除を実行
 */
export declare function confirmDelete(params: {
    ctx: AuthContext;
    confirmToken: string;
}): Promise<ConfirmResult>;
//# sourceMappingURL=dryrun.d.ts.map