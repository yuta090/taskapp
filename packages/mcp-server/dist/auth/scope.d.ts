/**
 * 指定した表の行(id)が、指定した space のものであることを確かめる。
 * 別の space の行・存在しない行は、呼んだ人に見せてよい理由(404)として断る。
 */
export declare function assertInSpace(table: string, id: string, spaceId: string, notFoundMessage?: string): Promise<void>;
/**
 * 渡した user たちが、指定した space の組織のメンバーであることを確かめる。
 * 1人でも組織外なら断る（呼んだ人に見せてよい理由=404。403にすると「組織に
 * いる/いない」自体を外部に教えてしまうため、行が無いときと同じ形で返す）。
 * 呼び出し側が組織での役割をそのまま使えるよう、確かめた行を user_id をキーに返す。
 */
export declare function assertUsersInSpaceOrg(userIds: string[], spaceId: string): Promise<Map<string, {
    role: string;
}>>;
/**
 * 渡した user たちが、指定した space のメンバーであることを確かめる（役割は問わない）。
 * 画面の担当者選択肢（タスクの担当者・会議の参加者・日程調整の回答者など）と同じ範囲。
 * 1人でも space 外なら断る（呼んだ人に見せてよい理由=404）。
 */
export declare function assertUsersAreSpaceMembers(userIds: string[], spaceId: string): Promise<void>;
/**
 * 渡した invite たちが、指定した space の未受諾(accepted_at is null)・期限内(expires_at > now)の
 * 招待であることを確かめる（画面の「招待中の担当者」候補と同じ範囲）。
 * 1人でも該当しなければ断る（呼んだ人に見せてよい理由=404）。
 */
export declare function assertInvitesAreInSpace(inviteIds: string[], spaceId: string): Promise<void>;
//# sourceMappingURL=scope.d.ts.map