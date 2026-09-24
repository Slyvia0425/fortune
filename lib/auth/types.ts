export interface AuthUser {
  id: string;
  email: string;
  display_name: string;
  status: string;
  created_at: string;
}

export interface AuthResult {
  user: AuthUser;
  session_token: string;
  expires_at: string;
}
