/*
 * Settings › AI & MCP Connectors text. Same table scheme as Settings › AI Models (../ai-models/strings.js):
 * English here; a language without its own table falls back to English. "$1" is replaced by S.fmt().
 */
import { langCode } from "@/services/l10n.js";

const en = {
  title: "AI & MCP Connectors",
  intro: "Connect AI providers and Model Context Protocol (MCP) servers. Keys are kept by your operating system's secure store, never in settings.",
  noDesktop: "Connectors need the WorkSuite Office desktop app on Windows or Linux. They are not available here yet.",
  aiOff: "Your organization has turned off AI on this computer.",
  externalOff: "Your organization allows only WorkSuite AI. Other providers and remote MCP servers are turned off.",
  storeFile: "No system keyring is running, so keys are kept in a file only you can read. Install GNOME Keyring or KWallet for better protection.",

  providers: "AI providers",
  providersText: "Providers the Office AI features can use: OpenAI-compatible services, Ollama on this computer, or your own endpoint. WorkSuite AI and Local AI are set up for you and are not listed here.",
  addProvider: "Add provider",
  noProviders: "No providers yet.",
  kind_openai: "OpenAI-compatible",
  kind_ollama: "Ollama",
  kind_custom: "Custom endpoint",
  local: "Local",
  cloud: "Cloud",
  baseUrl: "Base URL",
  baseUrlHint_openai: "For example https://api.openai.com/v1",
  baseUrlHint_ollama: "Ollama listens on http://127.0.0.1:11434 by default.",
  baseUrlHint_custom: "An OpenAI-compatible API: the address before /chat/completions.",
  manualModels: "Models (optional)",
  manualModelsHint: "Comma-separated, for endpoints that cannot list their models.",
  useInEditors: "Use in the Office AI features",
  useInEditorsText: "Adds this provider to the editors' AI functions (writing, grammar, summarize, translate, formulas). The editors keep their own copy of the key.",
  models: "Models",
  modelsCount: "$1 models",
  noModels: "No models found.",
  defaultProvider: "Default provider and model",
  provider: "Provider",
  defaultText: "What the Office AI features use unless you pick something else in the editor.",
  none: "None",
  setDefault: "Set as default",
  defaultSet: "Default set.",

  servers: "MCP servers",
  serversText: "MCP servers give AI agents tools, resources and prompts. Each tool call asks you first.",
  addServer: "Add server",
  noServers: "No MCP servers yet.",
  transport: "Transport",
  transport_stdio: "Local command (stdio)",
  "transport_streamable-http": "Remote (Streamable HTTP)",
  sseLegacy: "Servers that only speak the older HTTP + SSE transport are not supported. Most offer Streamable HTTP at /mcp.",
  command: "Command",
  commandHint: "The program and its arguments, for example: npx -y @modelcontextprotocol/server-filesystem C:\\Docs",
  cwd: "Working folder (optional)",
  env: "Environment variables",
  envHint: "One NAME=value per line. Not secret: kept in settings.",
  secretEnv: "Secret environment variable",
  secretEnvHint: "Its value is kept in the secure store and given to the server only when it starts.",
  secretEnvName: "Name",
  secretEnvValue: "Value",
  secretEnvSaved: "$1 (saved)",
  url: "Server URL",
  urlHint: "For example https://example.com/mcp",
  timeout: "Time limit (seconds)",

  auth: "Authentication",
  auth_none: "None",
  auth_bearer: "API key (Authorization: Bearer)",
  auth_header: "API key in a header",
  auth_oauth: "OAuth 2.1 sign-in (coming soon)",
  oauthSoon: "OAuth sign-in for MCP servers is not available yet. Use an API key if the server offers one.",
  headerName: "Header name",
  apiKey: "API key",
  apiKeySaved: "A key is saved. Leave empty to keep it.",
  removeKey: "Remove saved key",

  name: "Name",
  enabled: "Enabled",
  save: "Save",
  cancel: "Cancel",
  edit: "Edit",
  remove: "Remove",
  removeConfirm: "Remove $1? Its saved keys are deleted too.",
  test: "Test connection",
  testing: "Testing…",
  refresh: "Refresh",
  close: "Close",

  status_unknown: "Not tested",
  status_ok: "Connected",
  status_error: "Error",
  status_testing: "Testing…",
  status_disabled: "Disabled",
  checked: "Checked $1",
  serverInfo: "$1 $2 · protocol $3",
  tools: "Tools",
  resources: "Resources",
  prompts: "Prompts",
  nothing: "None",
  listFailed: "The server did not list them.",
  readOnly: "read-only",
  destructive: "can change data",
  tryTool: "Run…",
  argsJson: "Arguments (JSON)",
  argsBad: "The arguments are not valid JSON.",
  run: "Run",
  result: "Result",
  toolError: "The tool reported an error.",

  permissions: "Permissions",
  permissionsText: "Tools you allowed to run without asking. AI agents always ask before they change a document or read a file.",
  noPermissions: "Every tool asks before it runs.",
  revoke: "Revoke",
  revokeAll: "Revoke all",

  log: "Activity log",
  logText: "Connections, tool calls and server messages on this computer. It never includes keys.",
  logEmpty: "Nothing yet.",
  clearLog: "Clear log",
  copyLog: "Copy log",
  copied: "Copied.",

  confirmTitle: "Allow this action?",
  confirmTool: "$1 wants to run the tool $2 on $3.",
  confirmToolNamed: "Run the tool $1 on $2?",
  confirmDocument: "$1 wants to change $2.",
  confirmFile: "$1 wants to read $2.",
  confirmArgs: "With these arguments:",
  confirmDestructive: "The server says this tool can change or delete data.",
  alwaysAllow: "Always allow this tool for this server",
  allow: "Allow",
  deny: "Deny",
  denied: "You did not allow it.",
  anAgent: "An AI agent",

  invalid_name_required: "Enter a name.",
  invalid_name_duplicate: "That name is already used.",
  invalid_command_required: "Enter a command.",
  invalid_url_invalid: "Enter an http:// or https:// address.",
  invalid_url_insecure: "A key can only be sent over https:// or to this computer.",
  invalid_baseUrl_invalid: "Enter an http:// or https:// address.",
  invalid_baseUrl_insecure: "A key can only be sent over https:// or to this computer.",
  invalid_header_invalid: "Enter a header name (letters, digits and -).",
  invalid_auth_oauth: "OAuth sign-in is coming soon; choose another option.",
  invalid_env: "These lines are not NAME=value: $1",

  "err_no-desktop": "This needs the desktop app.",
  "err_bad-config": "The settings are not complete.",
  "err_not-found": "The command was not found: $1. Check that it is installed and on the PATH.",
  "err_spawn-failed": "The command could not be started: $1",
  err_exited: "The server stopped: $1. See the activity log for what it printed.",
  err_timeout: "No answer in time.",
  err_network: "Could not reach the server: $1",
  "err_bad-url": "That address cannot be used.",
  "err_insecure-secret": "A key can only be sent over https:// or to this computer.",
  "err_secret-store": "The key could not be read from or saved in the secure store: $1",
  err_auth: "The server wants a valid key or sign-in (401). $1",
  err_forbidden: "The server refused access (403). $1",
  "err_http-404": "Nothing at that address (404). Check the URL; MCP servers often use /mcp.",
  err_http: "The server answered with an error: $1",
  "err_not-mcp": "That does not look like an MCP server: $1",
  err_version: "The server speaks an MCP version this app does not support: $1",
  err_rpc: "The server reported an error: $1",
  err_denied: "You did not allow it.",
  err_models: "The provider answered, but not with a model list.",
  actionFailed: "That did not work: $1",
};

export const TABLES = { en };

export function tableFor(code) {
  const c = String(code || "en").slice(0, 2).toLowerCase();
  return TABLES[c] || en;
}

export const S = new Proxy(
  {},
  {
    get(_, key) {
      if (key === "fmt") return (k, ...args) => args.reduce((s, a, i) => s.split("$" + (i + 1)).join(a), S[k]);
      const table = tableFor(langCode());
      return table[key] ?? en[key] ?? String(key);
    },
  },
);

/* an McpError (or a native answer) as a sentence */
export function errorText(e) {
  const code = (e && e.code) || "rpc";
  const key = "err_" + code;
  const detail = (e && (e.detail || e.message)) || "";
  return en[key] ? S.fmt(key, detail).trim() : S.fmt("actionFailed", detail || code);
}
