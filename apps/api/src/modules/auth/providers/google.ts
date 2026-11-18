import { Google, decodeIdToken, generateCodeVerifier, generateState } from 'arctic';

export interface GoogleClaims {
  sub: string;
  name?: string;
  picture?: string;
  email?: string;
  email_verified?: boolean;
}

export class GoogleOAuth {
  private readonly client: Google;

  constructor(clientId: string, clientSecret: string, redirectUri: string) {
    this.client = new Google(clientId, clientSecret, redirectUri);
  }

  start(): { url: string; state: string; codeVerifier: string } {
    const state = generateState();
    const codeVerifier = generateCodeVerifier();
    const url = this.client.createAuthorizationURL(state, codeVerifier, [
      'openid',
      'profile',
      'email',
    ]);
    url.searchParams.set('prompt', 'select_account');
    return { url: url.toString(), state, codeVerifier };
  }

  async finish(code: string, codeVerifier: string): Promise<GoogleClaims> {
    const tokens = await this.client.validateAuthorizationCode(code, codeVerifier);
    const claims = decodeIdToken(tokens.idToken()) as GoogleClaims;
    if (!claims.sub) throw new Error('google: no sub');
    return claims;
  }
}
