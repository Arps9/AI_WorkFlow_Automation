export interface IntegrationMetadata {
  id: string;
  name: string;
  description: string;
  category: 'email' | 'communication' | 'project_management' | 'developer' | 'productivity' | 'storage';
  icon: string;
  status: 'connected' | 'available';
  /** user = connected by this user, env = org-wide keys in .env, demo = simulated data, none = unavailable */
  connectionSource: 'user' | 'env' | 'demo' | 'none';
  accountEmail?: string;
  accountName?: string;
  capabilities: string[];
  tools: string[];
  authType: 'oauth2' | 'api_key';
  docsUrl?: string;
  credentialFields?: Array<{ key: string; label: string; type: string; placeholder: string; required: boolean; help?: string }>;
  oauthConfigured?: boolean;
  sharedGoogleGrant?: boolean;
  lastError?: string;
}
