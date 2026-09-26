import { mkdir, writeFile } from "node:fs/promises";

const login = process.env.USERNAME;
const token = process.env.GITHUB_TOKEN;
const outputDirectory = "generated";
const languageLimit = 8;

const query = `
query ($login: String!) {
  user(login: $login) {
    followers { totalCount }
    pullRequests(states: MERGED) { totalCount }
    contributionsCollection {
      totalCommitContributions
      contributionCalendar { totalContributions }
    }
    repositories(first: 100, ownerAffiliations: OWNER, isFork: false) {
      totalCount
      nodes {
        stargazerCount
        languages(first: 10, orderBy: { field: SIZE, direction: DESC }) {
          edges { size node { name color } }
        }
      }
    }
  }
}`;

const theme = {
  background: "#070a1a",
  border: "#2a2350",
  gold: "#f7b32b",
  label: "#8b93b8",
  value: "#f5efe0",
  track: "#151a33",
};

const fonts = {
  serif: "'Cinzel', 'Trajan Pro', Georgia, 'Times New Roman', serif",
  mono: "'JetBrains Mono', 'Fira Code', SFMono-Regular, Menlo, Consolas, monospace",
};

async function fetchUser() {
  if (!login || !token) {
    throw new Error("USERNAME and GITHUB_TOKEN env vars are required");
  }
  const response = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: { Authorization: `bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query, variables: { login } }),
  });
  if (!response.ok) {
    throw new Error(`GitHub API responded ${response.status}`);
  }
  const payload = await response.json();
  if (payload.errors) {
    throw new Error(JSON.stringify(payload.errors));
  }
  return payload.data.user;
}

function escapeXml(text) {
  return String(text).replace(/[<>&'"]/g, (character) => `&#${character.charCodeAt(0)};`);
}

function formatNumber(value) {
  return new Intl.NumberFormat("en", { notation: "compact" }).format(value);
}

function renderCard(title, body) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="440" height="180" viewBox="0 0 440 180" role="img" aria-label="${escapeXml(title)}">
  <style>
    .fade { animation: fade .8s ease both; }
    @keyframes fade { from { opacity: 0; transform: translateY(6px); } }
    .grow { transform-box: fill-box; transform-origin: left center; animation: grow 1.2s cubic-bezier(.2,.8,.2,1) both; }
    @keyframes grow { from { transform: scaleX(0); } }
  </style>
  <rect x=".5" y=".5" width="439" height="179" rx="14" fill="${theme.background}" stroke="${theme.border}"/>
  <text x="24" y="36" font-family="${fonts.serif}" font-size="13" letter-spacing="3.5" fill="${theme.gold}">${escapeXml(title)}</text>
  <rect x="24" y="46" width="392" height="1" fill="${theme.gold}" opacity=".25"/>
  ${body}
</svg>
`;
}

function renderStatsCard(user) {
  const stars = user.repositories.nodes.reduce((total, repository) => total + repository.stargazerCount, 0);
  const stats = [
    ["contributions / yr", user.contributionsCollection.contributionCalendar.totalContributions],
    ["commits / yr", user.contributionsCollection.totalCommitContributions],
    ["merged PRs (wins)", user.pullRequests.totalCount],
    ["stars earned", stars],
    ["repos owned", user.repositories.totalCount],
    ["followers", user.followers.totalCount],
  ];
  const cells = stats.map(([label, value], index) => {
    const column = index % 2;
    const row = Math.floor(index / 2);
    const x = 24 + column * 208;
    const y = 76 + row * 36;
    return `<g class="fade" style="animation-delay:${index * 0.08}s" font-family="${fonts.mono}">
    <text x="${x}" y="${y}" font-size="11" fill="${theme.label}">${escapeXml(label)}</text>
    <text x="${x + 184}" y="${y}" font-size="15" font-weight="700" text-anchor="end" fill="${theme.value}">${formatNumber(value)}</text>
    <rect x="${x}" y="${y + 10}" width="184" height="1" fill="${theme.border}"/>
  </g>`;
  });
  return renderCard("MATCH HISTORY", cells.join("\n  "));
}

function collectLanguages(user) {
  const sizeByLanguage = new Map();
  for (const repository of user.repositories.nodes) {
    for (const edge of repository.languages.edges) {
      const current = sizeByLanguage.get(edge.node.name) ?? { size: 0, color: edge.node.color ?? theme.label };
      current.size += edge.size;
      sizeByLanguage.set(edge.node.name, current);
    }
  }
  const languages = [...sizeByLanguage.entries()]
    .map(([name, { size, color }]) => ({ name, size, color }))
    .sort((left, right) => right.size - left.size)
    .slice(0, languageLimit);
  const totalSize = languages.reduce((total, language) => total + language.size, 0);
  return languages.map((language) => ({ ...language, share: totalSize ? language.size / totalSize : 0 }));
}

function renderLanguagesCard(user) {
  const languages = collectLanguages(user);
  if (languages.length === 0) {
    return renderCard("MOST PICKED HEROES", `<text x="24" y="100" font-family="${fonts.mono}" font-size="12" fill="${theme.label}">no heroes picked yet</text>`);
  }
  const barWidth = 392;
  let offset = 24;
  const segments = languages.map((language) => {
    const width = Math.max(language.share * barWidth, 2);
    const segment = `<rect x="${offset.toFixed(1)}" y="60" width="${width.toFixed(1)}" height="10" fill="${language.color}"/>`;
    offset += width;
    return segment;
  });
  const legend = languages.map((language, index) => {
    const x = 24 + (index % 2) * 208;
    const y = 96 + Math.floor(index / 2) * 22;
    return `<g class="fade" style="animation-delay:${0.3 + index * 0.06}s" font-family="${fonts.mono}" font-size="11">
    <circle cx="${x + 5}" cy="${y - 4}" r="5" fill="${language.color}"/>
    <text x="${x + 16}" y="${y}" fill="${theme.value}">${escapeXml(language.name)}</text>
    <text x="${x + 184}" y="${y}" text-anchor="end" fill="${theme.label}">${(language.share * 100).toFixed(1)}%</text>
  </g>`;
  });
  const bar = `<clipPath id="bar"><rect x="24" y="60" width="${barWidth}" height="10" rx="5"/></clipPath>
  <rect x="24" y="60" width="${barWidth}" height="10" rx="5" fill="${theme.track}"/>
  <g class="grow" clip-path="url(#bar)">${segments.join("")}</g>`;
  return renderCard("MOST PICKED HEROES", `${bar}\n  ${legend.join("\n  ")}`);
}

const user = await fetchUser();
await mkdir(outputDirectory, { recursive: true });
await writeFile(`${outputDirectory}/stats.svg`, renderStatsCard(user));
await writeFile(`${outputDirectory}/languages.svg`, renderLanguagesCard(user));
console.log(`wrote ${outputDirectory}/stats.svg and ${outputDirectory}/languages.svg`);
