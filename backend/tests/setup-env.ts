// Tests run fully offline: no Gemini key, no Google OAuth, demo mode on.
process.env.NODE_ENV = 'test';
process.env.GEMINI_API_KEY = '';
process.env.GOOGLE_CLIENT_ID = '';
process.env.GOOGLE_CLIENT_SECRET = '';
process.env.SLACK_BOT_TOKEN = '';
process.env.JIRA_API_TOKEN = '';
process.env.GITHUB_TOKEN = '';
process.env.NOTION_API_KEY = '';
process.env.DEMO_MODE = 'true';
process.env.JWT_SECRET = 'test-secret';
