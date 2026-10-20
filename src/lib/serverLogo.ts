// Which brand a server belongs to, so it can wear its logo: by its name, its URL's host, or a
// word in its package or image name. Only exact words count, so `git` never claims `github`.

import {
  type SimpleIcon,
  siAngular,
  siAtlassian,
  siAuth0,
  siBrave,
  siBuildkite,
  siCircleci,
  siClickhouse,
  siCloudflare,
  siConvex,
  siDatadog,
  siDigitalocean,
  siDocker,
  siExpo,
  siFigma,
  siFirebase,
  siFlydotio,
  siGit,
  siGithub,
  siGitlab,
  siGooglebigquery,
  siGooglechrome,
  siGoogledrive,
  siGrafana,
  siHuggingface,
  siIntercom,
  siKubernetes,
  siLinear,
  siModelcontextprotocol,
  siMongodb,
  siNeon,
  siNetlify,
  siNewrelic,
  siNextdotjs,
  siNotion,
  siPagerduty,
  siPerplexity,
  siPlanetscale,
  siPostgresql,
  siPosthog,
  siPostman,
  siPrisma,
  siPulumi,
  siRailway,
  siRedis,
  siRender,
  siResend,
  siSentry,
  siShopify,
  siSnyk,
  siSocket,
  siSonarqubecloud,
  siSquare,
  siStripe,
  siSupabase,
  siSvelte,
  siTerraform,
  siTodoist,
  siTurso,
  siUpstash,
  siVercel,
  siXcode,
  siZapier,
} from 'simple-icons'
import type { McpServer } from './types'

/** Words that name a brand, most specific first. */
const BRANDS: [string[], SimpleIcon][] = [
  [['github'], siGithub],
  [['gitlab'], siGitlab],
  [['linear'], siLinear],
  [['notion'], siNotion],
  [['sentry'], siSentry],
  [['supabase'], siSupabase],
  [['postgres', 'postgresql', 'pg'], siPostgresql],
  [['figma'], siFigma],
  [['stripe'], siStripe],
  [['vercel'], siVercel],
  [['cloudflare'], siCloudflare],
  [['atlassian', 'jira', 'confluence'], siAtlassian],
  [['gdrive', 'googledrive'], siGoogledrive],
  [['mongodb', 'mongo'], siMongodb],
  [['redis'], siRedis],
  [['upstash'], siUpstash],
  [['neon'], siNeon],
  [['prisma'], siPrisma],
  [['firebase'], siFirebase],
  [['brave'], siBrave],
  [['netlify'], siNetlify],
  [['terraform'], siTerraform],
  [['chrome'], siGooglechrome],
  [['perplexity'], siPerplexity],
  [['huggingface'], siHuggingface],
  [['socket'], siSocket],
  [['snyk'], siSnyk],
  [['datadog', 'datadoghq'], siDatadog],
  [['newrelic'], siNewrelic],
  [['pagerduty'], siPagerduty],
  [['grafana'], siGrafana],
  [['posthog'], siPosthog],
  [['intercom'], siIntercom],
  [['zapier'], siZapier],
  [['xcode'], siXcode],
  [['nextjs', 'next'], siNextdotjs],
  [['circleci'], siCircleci],
  [['buildkite'], siBuildkite],
  [['kubernetes', 'k8s', 'kubectl'], siKubernetes],
  [['postman'], siPostman],
  [['railway'], siRailway],
  [['render'], siRender],
  [['digitalocean'], siDigitalocean],
  [['convex'], siConvex],
  [['planetscale', 'pscale'], siPlanetscale],
  [['angular'], siAngular],
  [['auth0'], siAuth0],
  [['bigquery'], siGooglebigquery],
  [['clickhouse'], siClickhouse],
  // Only the name: a command of docker would claim every container, whatever its image.
  [['dockerhub'], siDocker],
  [['expo'], siExpo],
  [['flyio', 'fly'], siFlydotio],
  [['pulumi'], siPulumi],
  [['resend'], siResend],
  [['shopify'], siShopify],
  [['sonarqube', 'sonarsource'], siSonarqubecloud],
  [['square', 'squareup'], siSquare],
  [['svelte'], siSvelte],
  [['todoist'], siTodoist],
  [['turso'], siTurso],
  [['git'], siGit],
]

const words = (text: string) =>
  text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean)

const brandIn = (text: string) => BRANDS.find(([names]) => words(text).some((w) => names.includes(w)))?.[1]

/** The server's logo, or null for none: a monogram stands in. */
export function serverLogo(name: string, server: McpServer): SimpleIcon | null {
  const byName = brandIn(name)
  if (byName) return byName
  if (server.transport !== 'stdio') {
    try {
      return brandIn(new URL(server.url).hostname) ?? null
    } catch {
      return null
    }
  }
  const parts = [server.command, ...server.args.filter((a): a is string => typeof a === 'string')]
  for (const part of parts) {
    const brand = brandIn(part)
    if (brand) return brand
  }
  // The protocol's own reference servers (filesystem, fetch, memory…) wear its mark.
  if (parts.some((part) => part.includes('@modelcontextprotocol/'))) return siModelcontextprotocol
  if (server.command === 'docker') return siDocker
  return null
}

/** Near-black and near-white brand colours vanish on one theme; those logos take the ink colour. */
export function isNeutralBrand(hex: string) {
  const n = Number.parseInt(hex, 16)
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255]
  const lum = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255
  return lum < 0.2 || lum > 0.85
}
