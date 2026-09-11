// scripts/contexto-golden.mjs — run once: node scripts/contexto-golden.mjs > backend/trivia/tests/fixtures/contexto_golden.json
// Copies the similarity code from src/Game Renderers/Contexto.tsx verbatim (kept only for this one-off),
// including awardsSimilarity() (magnitude-ratio-scaled cosine, added in 146b653) — NOT plain cosine.
import fs from "node:fs";
const rows = JSON.parse(fs.readFileSync("backend/trivia/tests/fixtures/players_fixture.json", "utf8"));
const pool = rows.filter((r) => r.teams && r.teams.length);
const CURRENT_YEAR = 2026;
function franchiseSeasons(p){const s=new Set();for(const t of p.teams){const end=t.end_year??CURRENT_YEAR;for(let y=t.start_year;y<=end;y++)s.add(`${t.abbr}:${y}`);}return s;}
function jaccard(a,b){if(a.size===0&&b.size===0)return 0;let i=0;for(const x of a)if(b.has(x))i++;const u=a.size+b.size-i;return u===0?0:i/u;}
function careerRange(p){let lo=Infinity,hi=-Infinity;for(const t of p.teams){if(t.start_year<lo)lo=t.start_year;const e=t.end_year??CURRENT_YEAR;if(e>hi)hi=e;}return lo===Infinity?[CURRENT_YEAR,CURRENT_YEAR]:[lo,hi];}
function eraOverlap(a,b){const inter=Math.max(0,Math.min(a[1],b[1])-Math.max(a[0],b[0])+1);const u=(a[1]-a[0]+1)+(b[1]-b[0]+1)-inter;return u<=0?0:inter/u;}
const POS={G:["G"],F:["F"],C:["C"],"G-F":["G","F"],"F-C":["F","C"]};
function positionFamily(a,b){if(a.position===b.position)return 1;const fb=POS[b.position]||[];return (POS[a.position]||[]).some((x)=>fb.includes(x))?0.5:0;}
function draftProximity(a,b){const ua=a.draft==null,ub=b.draft==null;if(ua&&ub)return 1;if(ua||ub)return 0;return Math.max(0,1-Math.abs(a.draft.pick-b.draft.pick)/60);}
function awardsVec(p){return [p.awards.mvp.length,p.awards.allstar_count,p.awards.rings.length,p.awards.dpoy.length];}
function magnitude(v){let n=0;for(const x of v)n+=x*x;return Math.sqrt(n);}
function cosine(a,b){let d=0;for(let i=0;i<a.length;i++)d+=a[i]*b[i];const na=magnitude(a),nb=magnitude(b);return na===0||nb===0?0:d/(na*nb);}
function awardsSimilarity(a,b){const na=magnitude(a),nb=magnitude(b);if(na===0&&nb===0)return 1;if(na===0||nb===0)return 0;return cosine(a,b)*(Math.min(na,nb)/Math.max(na,nb));}
function similarity(s,p){return 35*jaccard(franchiseSeasons(s),franchiseSeasons(p))+20*eraOverlap(careerRange(s),careerRange(p))+15*positionFamily(s,p)+10*(s.country===p.country?1:0)+10*draftProximity(s,p)+10*awardsSimilarity(awardsVec(s),awardsVec(p));}
const secret = pool.find((p) => p.person_id === 2544) ?? pool[0]; // LeBron if present
const scored = pool.map((p)=>({p,s:similarity(secret,p)})).sort((x,y)=>y.s-x.s||x.p.person_id-y.p.person_id);
process.stdout.write(JSON.stringify({ secret_person_id: secret.person_id, current_year: CURRENT_YEAR, top: scored.slice(0, 40).map((r, i) => [r.p.person_id, i + 1]) }, null, 1));
