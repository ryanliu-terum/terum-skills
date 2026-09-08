import type { TokenKey } from '../../backend/types';
export const token=(key:TokenKey)=>`var(--tk-${key})`;
