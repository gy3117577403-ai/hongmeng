export const MIN_PASSWORD_LENGTH = 8;

const COMMON_PASSWORDS = new Set([
  '12345678',
  '123456789',
  '1234567890',
  'password',
  'password1',
  'admin123',
  'qwerty123',
  '11111111',
]);

export function validateNewPassword(password: string, username?: string | null): string | null {
  if (password.length < MIN_PASSWORD_LENGTH) {
    return `密码至少 ${MIN_PASSWORD_LENGTH} 位`;
  }
  const normalized = password.trim().toLowerCase();
  if (!normalized || COMMON_PASSWORDS.has(normalized)) {
    return '密码过于常见，请更换后重试';
  }
  if (/^(.)\1+$/.test(password)) {
    return '密码不能全部使用相同字符';
  }
  const normalizedUsername = String(username || '').trim().toLowerCase();
  if (normalizedUsername && normalized.includes(normalizedUsername)) {
    return '密码不能包含完整登录账号';
  }
  return null;
}
