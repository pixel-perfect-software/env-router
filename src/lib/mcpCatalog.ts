// Well-known MCP servers, each written from the vendor's own docs or README, so adding one is a
// pick and a token rather than a search. Only vendors' own, maintained servers; where a vendor
// hosts one, its remote server. Remote servers that sign in with OAuth need no secret here: the
// agent signs in itself with /mcp. Secrets sit only in env or headers, never args or URLs, and
// containers run under --init so they stop with the agent. Sorted by label.

import type { McpServer } from './types'

export interface CatalogEntry {
  /** The name it's added under. */
  name: string
  label: string
  description: string
  server: McpServer
  /** Env or header names left for the user to fill with a secret, and what to type there. */
  secrets?: Record<string, string>
  /** How it signs in, when it does without a secret: OAuth through the agent's /mcp, or the vendor's own sign-in. */
  signIn?: 'mcp' | 'own'
}

/** What a server needs before it works, as the catalog shows and filters it. */
export type Access = 'secret' | 'mcp' | 'own' | 'none'

export const accessOf = (entry: CatalogEntry): Access => (entry.secrets ? 'secret' : (entry.signIn ?? 'none'))

/** Whether it runs on this machine: a command, or a server the user runs at a loopback address. */
export const isLocal = (server: McpServer) => server.transport === 'stdio' || /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:|\/|$)/i.test(server.url)

export interface CatalogFilter {
  query: string
  where: 'all' | 'remote' | 'local'
  /** Both kinds of sign-in count as one here; a row says which. */
  access: 'all' | 'secret' | 'sign-in' | 'none'
}

/** The entries matching `filter`, by label. The query matches the label, name and description, word by word. */
export function filterCatalog(entries: CatalogEntry[], { query, where, access }: CatalogFilter): CatalogEntry[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  return entries
    .filter((entry) => where === 'all' || isLocal(entry.server) === (where === 'local'))
    .filter((entry) => {
      const needs = accessOf(entry)
      return access === 'all' || needs === access || (access === 'sign-in' && (needs === 'mcp' || needs === 'own'))
    })
    .filter((entry) => {
      const text = `${entry.label} ${entry.name} ${entry.description}`.toLowerCase()
      return words.every((word) => text.includes(word))
    })
    .sort((a, b) => a.label.localeCompare(b.label))
}

export const catalog = (home: string): CatalogEntry[] => [
  {
    name: 'aikido',
    label: 'Aikido',
    description: 'Scans code for vulnerabilities and leaked secrets with Aikido. Signs in through a link on first use.',
    signIn: 'own',
    server: { transport: 'stdio', command: 'npx', args: ['-y', '@aikidosec/mcp'], env: {} },
  },
  {
    name: 'angular-cli',
    label: 'Angular CLI',
    description: "Angular best practices, docs search, and the workspace's projects and build targets.",
    server: { transport: 'stdio', command: 'npx', args: ['-y', '@angular/cli', 'mcp'], env: {} },
  },
  {
    name: 'apify',
    label: 'Apify',
    description: 'Runs Apify Actors for scraping and automation, and searches the Apify docs.',
    signIn: 'mcp',
    server: { transport: 'http', url: 'https://mcp.apify.com', headers: {} },
  },
  {
    name: 'atlassian',
    label: 'Atlassian',
    description: 'Jira issues and Confluence pages.',
    signIn: 'mcp',
    server: { transport: 'http', url: 'https://mcp.atlassian.com/v2/mcp', headers: {} },
  },
  {
    name: 'auth0',
    label: 'Auth0',
    description: 'Applications, APIs, actions and logs in an Auth0 tenant. Signs in once with npx @auth0/auth0-mcp-server init.',
    signIn: 'own',
    server: { transport: 'stdio', command: 'npx', args: ['-y', '@auth0/auth0-mcp-server', 'run'], env: {} },
  },
  {
    name: 'aws',
    label: 'AWS',
    description: "AWS's managed server: any AWS API, plus documentation and skills. Needs the AWSMCPSignInOAuthAccessPolicy IAM policy.",
    signIn: 'mcp',
    server: { transport: 'http', url: 'https://aws-mcp.us-east-1.api.aws/mcp', headers: {} },
  },
  {
    name: 'aws-knowledge',
    label: 'AWS Knowledge',
    description: 'AWS documentation, code samples and what each Region offers. Leave it out beside the AWS server, whose tools overlap.',
    server: { transport: 'http', url: 'https://knowledge-mcp.global.api.aws', headers: {} },
  },
  {
    name: 'azure',
    label: 'Azure',
    description: 'Azure resources and services, signed in through the Azure CLI (az login).',
    signIn: 'own',
    server: { transport: 'stdio', command: 'npx', args: ['-y', '@azure/mcp@latest', 'server', 'start'], env: {} },
  },
  {
    name: 'azure-devops',
    label: 'Azure DevOps',
    description: 'Work items, repos, pull requests, pipelines and wikis; change my-org to your organization. Signs in with your Microsoft account.',
    signIn: 'own',
    server: { transport: 'stdio', command: 'npx', args: ['-y', '@azure-devops/mcp', 'my-org'], env: {} },
  },
  {
    name: 'bigquery',
    label: 'BigQuery',
    description: 'Datasets, schemas and SQL in the project set in BIGQUERY_PROJECT, signed in with gcloud auth application-default login.',
    signIn: 'own',
    server: {
      transport: 'stdio',
      command: 'npx',
      args: ['-y', '@toolbox-sdk/server', '--prebuilt=bigquery', '--stdio'],
      env: { BIGQUERY_PROJECT: '' },
    },
  },
  {
    name: 'brave-search',
    label: 'Brave Search',
    description: 'Web, news, image, video and local search through the Brave Search API.',
    server: {
      transport: 'stdio',
      command: 'npx',
      args: ['-y', '@brave/brave-search-mcp-server', '--transport', 'stdio'],
      env: { BRAVE_API_KEY: '' },
    },
    secrets: { BRAVE_API_KEY: 'BSA…' },
  },
  {
    name: 'browserbase',
    label: 'Browserbase',
    description: 'Cloud browsers that navigate, act on and extract from pages. Takes an API key.',
    server: { transport: 'http', url: 'https://mcp.browserbase.com/mcp', headers: { Authorization: '' } },
    secrets: { Authorization: 'Bearer bb_live_…' },
  },
  {
    name: 'buildkite',
    label: 'Buildkite',
    description: 'Pipelines, builds, job logs and test results in Buildkite.',
    signIn: 'mcp',
    server: { transport: 'http', url: 'https://mcp.buildkite.com/mcp', headers: {} },
  },
  {
    name: 'canva',
    label: 'Canva',
    description: 'Searches, creates and edits designs in your Canva account.',
    signIn: 'mcp',
    server: { transport: 'http', url: 'https://mcp.canva.com/mcp', headers: {} },
  },
  {
    name: 'chrome-devtools',
    label: 'Chrome DevTools',
    description: 'Controls and inspects a live Chrome: console, network, performance traces.',
    server: { transport: 'stdio', command: 'npx', args: ['-y', 'chrome-devtools-mcp@latest'], env: {} },
  },
  {
    name: 'circleci',
    label: 'CircleCI',
    description: 'Build failures, logs, flaky tests and pipeline status in CircleCI.',
    signIn: 'mcp',
    server: { transport: 'http', url: 'https://mcp.circleci.com/v1/mcp', headers: {} },
  },
  {
    name: 'clickhouse',
    label: 'ClickHouse Cloud',
    description: 'Queries ClickHouse Cloud services, read-only. Turn MCP on for each service in the console.',
    signIn: 'mcp',
    server: { transport: 'http', url: 'https://mcp.clickhouse.cloud/mcp', headers: {} },
  },
  {
    name: 'cloudflare',
    label: 'Cloudflare',
    description: 'The whole Cloudflare API through code the agent writes: Workers, DNS, R2 and more.',
    signIn: 'mcp',
    server: { transport: 'http', url: 'https://mcp.cloudflare.com/mcp', headers: {} },
  },
  {
    name: 'cloudflare-docs',
    label: 'Cloudflare Docs',
    description: "Searches Cloudflare's developer documentation.",
    server: { transport: 'http', url: 'https://docs.mcp.cloudflare.com/mcp', headers: {} },
  },
  {
    name: 'context7',
    label: 'Context7',
    description: 'Current documentation and code examples for libraries.',
    server: { transport: 'http', url: 'https://mcp.context7.com/mcp', headers: {} },
  },
  {
    name: 'convex',
    label: 'Convex',
    description: 'Tables, data, functions, logs and environment variables of Convex deployments. Signs in with npx convex login.',
    signIn: 'own',
    server: { transport: 'stdio', command: 'npx', args: ['-y', 'convex@latest', 'mcp', 'start'], env: {} },
  },
  {
    name: 'datadog',
    label: 'Datadog',
    description: 'Logs, metrics, traces, monitors and incidents, on the US1 site.',
    signIn: 'mcp',
    server: { transport: 'http', url: 'https://mcp.datadoghq.com/v1/mcp', headers: {} },
  },
  {
    name: 'deepwiki',
    label: 'DeepWiki',
    description: 'Documentation and answers about public GitHub repositories.',
    server: { transport: 'http', url: 'https://mcp.deepwiki.com/mcp', headers: {} },
  },
  {
    name: 'digitalocean',
    label: 'DigitalOcean',
    description: 'App Platform, Droplets, databases, Kubernetes, Spaces and more, through one DigitalOcean router.',
    signIn: 'mcp',
    server: { transport: 'http', url: 'https://mcp.digitalocean.com/mcp', headers: {} },
  },
  {
    name: 'dockerhub',
    label: 'Docker Hub',
    description: 'Searches Docker Hub images and tags, and manages your repositories; change your-hub-username. Needs Docker.',
    server: {
      transport: 'stdio',
      command: 'docker',
      args: ['run', '--init', '-i', '--rm', '-e', 'HUB_PAT_TOKEN', 'mcp/dockerhub', '--transport=stdio', '--username=your-hub-username'],
      env: { HUB_PAT_TOKEN: '' },
    },
    secrets: { HUB_PAT_TOKEN: 'dckr_pat_…' },
  },
  {
    name: 'exa',
    label: 'Exa',
    description: 'Web search, code search and page contents. Free and rate-limited without a key.',
    server: { transport: 'http', url: 'https://mcp.exa.ai/mcp', headers: {} },
  },
  {
    name: 'expo',
    label: 'Expo',
    description: 'Expo and EAS docs, builds and project tools, signed in with your Expo account.',
    signIn: 'mcp',
    server: { transport: 'http', url: 'https://mcp.expo.dev/mcp', headers: {} },
  },
  {
    name: 'fetch',
    label: 'Fetch',
    description: 'Fetches a URL and turns the page into Markdown. Needs uv.',
    server: { transport: 'stdio', command: 'uvx', args: ['mcp-server-fetch'], env: {} },
  },
  {
    name: 'figma',
    label: 'Figma',
    description: 'Design context, variables and screenshots from Figma files, and writes to the canvas.',
    signIn: 'mcp',
    server: { transport: 'http', url: 'https://mcp.figma.com/mcp', headers: {} },
  },
  {
    name: 'figma-desktop',
    label: 'Figma (desktop)',
    description: "The Figma desktop app's local server, turned on from Dev Mode. Needs a Dev or Full seat on a paid plan.",
    signIn: 'own',
    server: { transport: 'http', url: 'http://127.0.0.1:3845/mcp', headers: {} },
  },
  {
    name: 'filesystem',
    label: 'Filesystem',
    description: 'Reads and writes files inside the folders listed as its arguments.',
    server: { transport: 'stdio', command: 'npx', args: ['-y', '@modelcontextprotocol/server-filesystem', home], env: {} },
  },
  {
    name: 'firebase',
    label: 'Firebase',
    description: 'Projects, Auth, Firestore, Storage, security rules and Hosting, signed in through the Firebase CLI (firebase login).',
    signIn: 'own',
    server: { transport: 'stdio', command: 'npx', args: ['-y', 'firebase-tools@latest', 'mcp'], env: {} },
  },
  {
    name: 'firecrawl',
    label: 'Firecrawl',
    description: 'Scrapes, crawls and searches the web, and turns pages into Markdown.',
    signIn: 'mcp',
    server: { transport: 'http', url: 'https://mcp.firecrawl.dev/v2/mcp-oauth', headers: {} },
  },
  {
    name: 'flyio',
    label: 'Fly.io',
    description: 'Apps, Machines, certificates and logs on Fly.io, signed in with fly auth login. Experimental.',
    signIn: 'own',
    server: { transport: 'stdio', command: 'fly', args: ['mcp', 'server'], env: {} },
  },
  {
    name: 'git',
    label: 'Git',
    description: 'Reads and changes local Git repositories. Needs uv.',
    server: { transport: 'stdio', command: 'uvx', args: ['mcp-server-git'], env: {} },
  },
  {
    name: 'github',
    label: 'GitHub',
    description: "GitHub's remote server: repositories, issues, pull requests and Actions. Takes a personal access token.",
    server: { transport: 'http', url: 'https://api.githubcopilot.com/mcp/', headers: { Authorization: '' } },
    secrets: { Authorization: 'Bearer github_pat_…' },
  },
  {
    name: 'gitlab',
    label: 'GitLab',
    description: 'Issues, merge requests, pipelines and search on GitLab.com; change the host for a self-managed instance.',
    signIn: 'mcp',
    server: { transport: 'http', url: 'https://gitlab.com/api/v4/mcp', headers: {} },
  },
  {
    name: 'grafana',
    label: 'Grafana',
    description: 'Dashboards, data sources, alerts and incidents in the Grafana instance set in GRAFANA_URL. Needs uv.',
    server: {
      transport: 'stdio',
      command: 'uvx',
      args: ['mcp-grafana'],
      env: { GRAFANA_URL: 'http://localhost:3000', GRAFANA_SERVICE_ACCOUNT_TOKEN: '' },
    },
    secrets: { GRAFANA_SERVICE_ACCOUNT_TOKEN: 'glsa_…' },
  },
  {
    name: 'grafana-cloud',
    label: 'Grafana Cloud',
    description: "Grafana's hosted server for a Grafana Cloud stack: metrics, logs, traces and dashboards. Asks for the stack's URL when signing in.",
    signIn: 'mcp',
    server: { transport: 'http', url: 'https://mcp.grafana.com/mcp', headers: {} },
  },
  {
    name: 'heroku',
    label: 'Heroku',
    description: 'Apps, dynos, add-ons, logs and Postgres on Heroku.',
    signIn: 'mcp',
    server: { transport: 'http', url: 'https://mcp.heroku.com/mcp', headers: {} },
  },
  {
    name: 'honeycomb',
    label: 'Honeycomb',
    description: 'Queries traces and events, and reads SLOs and triggers, in the US region.',
    signIn: 'mcp',
    server: { transport: 'http', url: 'https://mcp.honeycomb.io/mcp', headers: {} },
  },
  {
    name: 'huggingface',
    label: 'Hugging Face',
    description: 'Models, datasets, Spaces, papers and docs on the Hugging Face Hub.',
    signIn: 'mcp',
    server: { transport: 'http', url: 'https://huggingface.co/mcp?login', headers: {} },
  },
  {
    name: 'intercom',
    label: 'Intercom',
    description: 'Conversations and contacts, for US-hosted workspaces.',
    signIn: 'mcp',
    server: { transport: 'http', url: 'https://mcp.intercom.com/mcp', headers: {} },
  },
  {
    name: 'kubernetes',
    label: 'Kubernetes',
    description: 'Pods, deployments, logs, events and Helm in the clusters of your kubeconfig, OpenShift included. Can change resources.',
    signIn: 'own',
    server: { transport: 'stdio', command: 'npx', args: ['-y', 'kubernetes-mcp-server@latest'], env: {} },
  },
  {
    name: 'launchdarkly',
    label: 'LaunchDarkly',
    description: 'Feature flags, targeting and observability in LaunchDarkly. Not on the EU or federal instances.',
    signIn: 'mcp',
    server: { transport: 'http', url: 'https://mcp.launchdarkly.com/mcp/launchdarkly', headers: {} },
  },
  {
    name: 'linear',
    label: 'Linear',
    description: 'Issues, projects and comments.',
    signIn: 'mcp',
    server: { transport: 'http', url: 'https://mcp.linear.app/mcp', headers: {} },
  },
  {
    name: 'memory',
    label: 'Memory',
    description: 'A knowledge graph the agent keeps between sessions.',
    server: { transport: 'stdio', command: 'npx', args: ['-y', '@modelcontextprotocol/server-memory'], env: {} },
  },
  {
    name: 'microsoft-learn',
    label: 'Microsoft Learn',
    description: "Searches and fetches Microsoft's official documentation and code samples.",
    server: { transport: 'http', url: 'https://learn.microsoft.com/api/mcp', headers: {} },
  },
  {
    name: 'mongodb',
    label: 'MongoDB',
    description: 'Queries a MongoDB database, read-only until --readOnly is removed.',
    server: {
      transport: 'stdio',
      command: 'npx',
      args: ['-y', 'mongodb-mcp-server@latest', '--readOnly'],
      env: { MDB_MCP_CONNECTION_STRING: '' },
    },
    secrets: { MDB_MCP_CONNECTION_STRING: 'mongodb://user:pass@host:27017/db' },
  },
  {
    name: 'neon',
    label: 'Neon',
    description: 'Neon Postgres projects, branches, SQL and migrations.',
    signIn: 'mcp',
    server: { transport: 'http', url: 'https://mcp.neon.tech/mcp', headers: {} },
  },
  {
    name: 'netlify',
    label: 'Netlify',
    description: 'Creates and deploys projects and manages their settings and environment variables.',
    signIn: 'mcp',
    server: { transport: 'http', url: 'https://netlify-mcp.netlify.app/mcp', headers: {} },
  },
  {
    name: 'newrelic',
    label: 'New Relic',
    description: 'Queries telemetry with NRQL, and reads alerts and entities, in the US region.',
    signIn: 'mcp',
    server: { transport: 'http', url: 'https://mcp.newrelic.com/mcp/', headers: {} },
  },
  {
    name: 'next-devtools',
    label: 'Next.js DevTools',
    description: 'Errors, routes and logs from a running Next.js 16 or later dev server, and docs matched to its version.',
    server: { transport: 'stdio', command: 'npx', args: ['-y', 'next-devtools-mcp@latest'], env: {} },
  },
  {
    name: 'notion',
    label: 'Notion',
    description: 'Search, read and edit pages and databases.',
    signIn: 'mcp',
    server: { transport: 'http', url: 'https://mcp.notion.com/mcp', headers: {} },
  },
  {
    name: 'pagerduty',
    label: 'PagerDuty',
    description: 'Incidents, services, schedules and on-call, in the US service region. Takes an API key.',
    server: { transport: 'http', url: 'https://mcp.pagerduty.com/mcp', headers: { Authorization: '' } },
    secrets: { Authorization: 'Token token=…' },
  },
  {
    name: 'perplexity',
    label: 'Perplexity',
    description: "Web-grounded answers and research from Perplexity's Sonar models, billed to the API organization you sign in to.",
    signIn: 'mcp',
    server: { transport: 'http', url: 'https://api.perplexity.ai/mcp', headers: {} },
  },
  {
    name: 'planetscale',
    label: 'PlanetScale',
    description: 'PlanetScale databases, branches, schema and queries.',
    signIn: 'mcp',
    server: { transport: 'http', url: 'https://mcp.pscale.dev/mcp/planetscale', headers: {} },
  },
  {
    name: 'playwright',
    label: 'Playwright',
    description: 'Drives a real browser through accessibility snapshots.',
    server: { transport: 'stdio', command: 'npx', args: ['@playwright/mcp@latest'], env: {} },
  },
  {
    name: 'postgres',
    label: 'Postgres',
    description:
      "Lists tables and runs SQL on a Postgres database, through Google's MCP Toolbox. execute_sql can write: connect as a read-only role, or turn it off in a profile.",
    server: {
      transport: 'stdio',
      command: 'npx',
      args: ['-y', '@toolbox-sdk/server', '--prebuilt=postgres', '--stdio'],
      env: { POSTGRES_HOST: 'localhost', POSTGRES_PORT: '5432', POSTGRES_DATABASE: 'postgres', POSTGRES_USER: 'postgres', POSTGRES_PASSWORD: '' },
    },
    secrets: { POSTGRES_PASSWORD: 'The database password' },
  },
  {
    name: 'posthog',
    label: 'PostHog',
    description: 'Product analytics, feature flags, experiments and error tracking.',
    signIn: 'mcp',
    server: { transport: 'http', url: 'https://mcp.posthog.com/mcp', headers: {} },
  },
  {
    name: 'postman',
    label: 'Postman',
    description: 'Collections, environments, specs and workspaces in Postman, in the US region. Its /mcp path has every tool.',
    signIn: 'mcp',
    server: { transport: 'http', url: 'https://mcp.postman.com/minimal', headers: {} },
  },
  {
    name: 'prisma',
    label: 'Prisma',
    description: 'Prisma Postgres databases, SQL and backups, and the Prisma docs.',
    signIn: 'mcp',
    server: { transport: 'http', url: 'https://mcp.prisma.io/mcp', headers: {} },
  },
  {
    name: 'pulumi',
    label: 'Pulumi',
    description: 'Pulumi Cloud stacks and resources, the Pulumi Registry, and Neo.',
    signIn: 'mcp',
    server: { transport: 'http', url: 'https://mcp.ai.pulumi.com/mcp', headers: {} },
  },
  {
    name: 'railway',
    label: 'Railway',
    description: 'Projects, services, deployments, variables and logs on Railway.',
    signIn: 'mcp',
    server: { transport: 'http', url: 'https://mcp.railway.com', headers: {} },
  },
  {
    name: 'redis',
    label: 'Redis',
    description: 'Reads and writes data in the Redis database set in REDIS_HOST and REDIS_PORT. Needs uv.',
    server: {
      transport: 'stdio',
      command: 'uvx',
      args: ['--from', 'redis-mcp-server@latest', 'redis-mcp-server'],
      env: { REDIS_HOST: '127.0.0.1', REDIS_PORT: '6379', REDIS_PWD: '' },
    },
    secrets: { REDIS_PWD: 'The database password' },
  },
  {
    name: 'render',
    label: 'Render',
    description: 'Services, deploys, logs, metrics and Postgres on Render. Takes an API key.',
    server: { transport: 'http', url: 'https://mcp.render.com/mcp', headers: { Authorization: '' } },
    secrets: { Authorization: 'Bearer rnd_…' },
  },
  {
    name: 'resend',
    label: 'Resend',
    description: 'Sends email, and manages domains, contacts, broadcasts and webhooks in Resend.',
    signIn: 'mcp',
    server: { transport: 'http', url: 'https://mcp.resend.com/mcp', headers: {} },
  },
  {
    name: 'semgrep',
    label: 'Semgrep',
    description: 'Scans code with Semgrep Code, Supply Chain and Secrets. Needs the Semgrep CLI, signed in with semgrep login.',
    signIn: 'own',
    server: { transport: 'stdio', command: 'semgrep', args: ['mcp'], env: {} },
  },
  {
    name: 'sentry',
    label: 'Sentry',
    description: 'Issues, errors and releases.',
    signIn: 'mcp',
    server: { transport: 'http', url: 'https://mcp.sentry.dev/mcp', headers: {} },
  },
  {
    name: 'sequential-thinking',
    label: 'Sequential Thinking',
    description: 'Structured, step-by-step problem solving.',
    server: { transport: 'stdio', command: 'npx', args: ['-y', '@modelcontextprotocol/server-sequential-thinking'], env: {} },
  },
  {
    name: 'shopify-dev',
    label: 'Shopify Dev',
    description: "Searches Shopify's developer docs and validates GraphQL, Liquid and UI extension code.",
    server: { transport: 'stdio', command: 'npx', args: ['-y', '@shopify/dev-mcp@latest'], env: {} },
  },
  {
    name: 'snyk',
    label: 'Snyk',
    description: 'Scans code, dependencies, containers and infrastructure as code with the Snyk CLI. Signs in with its snyk_auth tool.',
    signIn: 'own',
    server: { transport: 'stdio', command: 'npx', args: ['-y', 'snyk@latest', 'mcp', '-t', 'stdio'], env: {} },
  },
  {
    name: 'socket',
    label: 'Socket',
    description: 'Scores open-source packages for supply-chain, vulnerability and licence risk.',
    signIn: 'mcp',
    server: { transport: 'http', url: 'https://mcp.socket.dev/', headers: {} },
  },
  {
    name: 'sonarqube',
    label: 'SonarQube',
    description: 'Issues, quality gates, hotspots and analysis in the SonarQube Cloud organization set in SONARQUBE_ORG. Needs Docker.',
    server: {
      transport: 'stdio',
      command: 'docker',
      args: ['run', '--init', '-i', '--rm', '-e', 'SONARQUBE_TOKEN', '-e', 'SONARQUBE_ORG', 'sonarsource/sonarqube-mcp'],
      env: { SONARQUBE_TOKEN: '', SONARQUBE_ORG: '' },
    },
    secrets: { SONARQUBE_TOKEN: 'A SonarQube user token' },
  },
  {
    name: 'square',
    label: 'Square',
    description: 'Payments, orders, catalog and customers in a Square seller account. Production data only.',
    signIn: 'mcp',
    server: { transport: 'http', url: 'https://mcp.squareup.com/mcp', headers: {} },
  },
  {
    name: 'stripe',
    label: 'Stripe',
    description: 'Customers, payments, subscriptions and the Stripe docs.',
    signIn: 'mcp',
    server: { transport: 'http', url: 'https://mcp.stripe.com', headers: {} },
  },
  {
    name: 'supabase',
    label: 'Supabase',
    description: 'Projects, tables, SQL, migrations and Edge Functions.',
    signIn: 'mcp',
    server: { transport: 'http', url: 'https://mcp.supabase.com/mcp', headers: {} },
  },
  {
    name: 'svelte',
    label: 'Svelte',
    description: 'Svelte and SvelteKit docs, and an autofixer for Svelte code.',
    server: { transport: 'http', url: 'https://mcp.svelte.dev/mcp', headers: {} },
  },
  {
    name: 'tavily',
    label: 'Tavily',
    description: 'Web search, extraction, crawling and site maps.',
    signIn: 'mcp',
    server: { transport: 'http', url: 'https://mcp.tavily.com/mcp/', headers: {} },
  },
  {
    name: 'terraform',
    label: 'Terraform',
    description: 'Providers, modules and policies from the Terraform Registry. Needs Docker.',
    server: { transport: 'stdio', command: 'docker', args: ['run', '--init', '-i', '--rm', 'hashicorp/terraform-mcp-server'], env: {} },
  },
  {
    name: 'time',
    label: 'Time',
    description: 'The current time, and conversions between time zones. Needs uv.',
    server: { transport: 'stdio', command: 'uvx', args: ['mcp-server-time'], env: {} },
  },
  {
    name: 'todoist',
    label: 'Todoist',
    description: 'Tasks, projects and comments in Todoist.',
    signIn: 'mcp',
    server: { transport: 'http', url: 'https://ai.todoist.net/mcp', headers: {} },
  },
  {
    name: 'turso',
    label: 'Turso',
    description: 'Turso Cloud organizations, databases and groups, and SQL.',
    signIn: 'mcp',
    server: { transport: 'http', url: 'https://mcp.turso.ai/mcp', headers: {} },
  },
  {
    name: 'twilio-docs',
    label: 'Twilio Docs',
    description: 'Searches Twilio, SendGrid and Segment docs and API specs. Read-only; makes no API calls.',
    server: { transport: 'http', url: 'https://mcp.twilio.com/docs', headers: {} },
  },
  {
    name: 'vercel',
    label: 'Vercel',
    description: 'Projects, deployments, logs and documentation.',
    signIn: 'mcp',
    server: { transport: 'http', url: 'https://mcp.vercel.com', headers: {} },
  },
  {
    name: 'xcode',
    label: 'Xcode',
    description: "Builds, tests and previews the project open in Xcode 26.3 or later. Turn on external agents in Xcode's Intelligence settings.",
    server: { transport: 'stdio', command: 'xcrun', args: ['mcpbridge'], env: {} },
  },
  {
    name: 'zapier',
    label: 'Zapier',
    description: 'Runs actions in the apps connected to your Zapier account.',
    signIn: 'mcp',
    server: { transport: 'http', url: 'https://mcp.zapier.com/api/v1/connect', headers: {} },
  },
]
