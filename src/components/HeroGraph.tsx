const nodes = [
  { x: 24, y: 150, title: 'Agree scope', owner: 'Person', tone: 'done', state: 'Finished' },
  { x: 268, y: 42, title: 'Build API', owner: 'Agent', tone: 'active', state: 'Working' },
  { x: 268, y: 258, title: 'Update client', owner: 'Agent', tone: 'active', state: 'Working' },
  { x: 512, y: 150, title: 'Review release', owner: 'Person', tone: 'queued', state: 'Not started' },
];

const lines = [
  'M 208 192 C 240 192 236 84 268 84',
  'M 208 192 C 240 192 236 300 268 300',
  'M 452 84 C 484 84 480 192 512 192',
  'M 452 300 C 484 300 480 192 512 192',
];

/** An illustration of the graph. It is not live data. */
export function HeroGraph() {
  return (
    <figure className="hero-graph">
      <svg viewBox="0 0 720 400" role="img" aria-label="Illustration: two agents working from one finished task, with an overlap warning between them, leading to a review.">
        {lines.map((line) => <path key={line} d={line} className="hero-line" />)}
        <path d="M 360 126 L 360 258" className="hero-overlap" />
        <g transform="translate(360 192)">
          <rect x="-72" y="-14" width="144" height="28" className="hero-overlap-tag" />
          <text textAnchor="middle" y="5" className="hero-overlap-text">POSSIBLE OVERLAP</text>
        </g>
        {nodes.map((node) => (
          <g key={node.title} transform={`translate(${node.x} ${node.y})`} className={`hero-node tone-${node.tone}`}>
            <rect width="184" height="84" className="hero-card" />
            <rect width="184" height="3" className="hero-rule" />
            <text x="14" y="26" className="hero-state">{node.state.toUpperCase()}</text>
            <text x="14" y="52" className="hero-title">{node.title}</text>
            <text x="14" y="71" className="hero-owner">{node.owner}</text>
          </g>
        ))}
      </svg>
      <figcaption>Illustration, not live data</figcaption>
    </figure>
  );
}
