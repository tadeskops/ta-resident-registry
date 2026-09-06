export type Ok<T> = { ok: true; data: T };
export type Bad = { ok: false; error: string };

export const ok = <T>(data: T): Ok<T> => ({ ok: true, data });
export const bad = (error: string): Bad => ({ ok: false, error });
