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
//# sourceMappingURL=scope.d.ts.map