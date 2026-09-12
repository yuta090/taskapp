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
 * 渡した user たちが、指定した space のメンバーで、かつ許可された役割であることを確かめる
 * （画面の担当者選択肢と同じ範囲: 相手先側=client/vendor、社内側=admin/editor/viewer）。
 * space外なら404（assertUsersAreSpaceMembersと同じ理由）、メンバーだが役割が合わなければ
 * 400（呼んだ人が直せる入力の問題として分かるように）。
 */
export declare function assertUsersHaveSpaceRole(userIds: string[], spaceId: string, allowedRoles: readonly string[], fieldLabel: string): Promise<void>;
/**
 * 渡した invite たちが、指定した space の未受諾(accepted_at is null)・期限内(expires_at > now)の
 * 招待であることを確かめる（画面の「招待中の担当者」候補と同じ範囲）。
 * 1人でも該当しなければ断る（呼んだ人に見せてよい理由=404）。
 */
export declare function assertInvitesAreInSpace(inviteIds: string[], spaceId: string): Promise<void>;
/**
 * 「誰がやったか」の記録が要る RPC（会議開始・レビュー承認など）を呼ぶ前に、
 * この鍵に紐づく利用者(user_id)を取り出す。画面は auth.uid() を使うのに対し、
 * service role で動くこの道具は鍵の持ち主をそのまま渡す。
 * 個人に紐づかない鍵（組織/space の共用鍵）では実行できない。
 */
export declare function requireActorUserId(): string;
//# sourceMappingURL=scope.d.ts.map