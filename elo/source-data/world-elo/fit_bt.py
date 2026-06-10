import csv, json, math
from collections import defaultdict, deque
from datetime import date
import numpy as np
from scipy.optimize import minimize

REF_DATE="2026-06-08"; HALFLIFE_DAYS=540.0; START="2024-01-01"
SHOOTOUT_WIN=0.6
PRIOR_SIGMA=0.20          # how far recent results may pull a team off its Elo anchor (theta units)
C=math.log(10)/400.0      # Elo -> theta (BT) scale conversion
TAU_FLOOR=0.5             # reported tau = recent-evidence precision (the user-agency knob), NOT 1/sigma^2

def comp_weight(t):
    if t in ("FIFA World Cup qualification","UEFA Nations League"): return 1.0
    if t in ("CONCACAF Nations League",): return 0.9
    if t in ("UEFA Euro","Copa América","African Cup of Nations","AFC Asian Cup",
             "Gold Cup","FIFA World Cup","CONMEBOL"): return 0.85
    if "qualification" in t: return 0.7
    if t in ("Friendly","FIFA Series","CONCACAF Series","Arab Cup","ASEAN Championship"): return 0.4
    return 0.6

def elo_K(t):
    if t=="FIFA World Cup": return 60
    if t in ("UEFA Euro","Copa América","African Cup of Nations","AFC Asian Cup",
             "Gold Cup","Confederations Cup"): return 50
    if "qualification" in t: return 40
    if t in ("Friendly","FIFA Series","CONCACAF Series"): return 20
    return 30

def days_between(d1,d2):
    a=date(*map(int,d1.split('-'))); b=date(*map(int,d2.split('-'))); return (b-a).days

rows=[r for r in csv.DictReader(open('results.csv'))]
played=lambda r: r['home_score'] not in ('','NA') and r['away_score'] not in ('','NA')
sh={}
for s in csv.DictReader(open('shootouts.csv')):
    sh[(s['date'],s['home_team'],s['away_team'])]=s['winner']

# ---------- 1) World Football Elo over the FULL history (chronological) ----------
elo=defaultdict(lambda:1500.0)
allrows=sorted([r for r in rows if played(r)], key=lambda r:r['date'])
for r in allrows:
    h,a=r['home_team'],r['away_team']; hs,as_=int(r['home_score']),int(r['away_score'])
    neutral=r['neutral'] in ('True','TRUE')
    ha=0 if neutral else 100
    dr=(elo[h]+ha)-elo[a]
    we=1/(1+10**(-dr/400))
    gd=abs(hs-as_)
    G=1.0 if gd<=1 else (1.5 if gd==2 else (11+gd)/8.0)
    W=1.0 if hs>as_ else (0.0 if hs<as_ else 0.5)
    K=elo_K(r['tournament'])
    delta=K*G*(W-we)
    elo[h]+=delta; elo[a]-=delta

# ---------- 2) recent weighted match list (dedupe, window, shootout credit) ----------
seen_keys=set(); M=[]
for r in rows:
    if r['date']<START or not played(r): continue
    key=(r['date'],r['home_team'],r['away_team'])
    if key in seen_keys: continue
    seen_keys.add(key)
    w=comp_weight(r['tournament'])*0.5**(days_between(r['date'],REF_DATE)/HALFLIFE_DAYS)
    if w<1e-4: continue
    M.append(dict(h=r['home_team'],a=r['away_team'],hs=int(r['home_score']),
                  as_=int(r['away_score']),neutral=r['neutral'] in ('True','TRUE'),w=w,key=key))

adj=defaultdict(set)
for m in M: adj[m['h']].add(m['a']); adj[m['a']].add(m['h'])
seen=set(); comps=[]
for s0 in adj:
    if s0 in seen: continue
    q=deque([s0]); seen.add(s0); comp=[]
    while q:
        u=q.popleft(); comp.append(u)
        for v in adj[u]:
            if v not in seen: seen.add(v); q.append(v)
    comps.append(comp)
core=set(max(comps,key=len))
M=[m for m in M if m['h'] in core and m['a'] in core]
teams=sorted(core); idx={t:i for i,t in enumerate(teams)}; n=len(teams)

# prior mean m_i = centered Elo, in theta units
elo_arr=np.array([elo[t] for t in teams])
m=(elo_arr-elo_arr.mean())*C

# match arrays with soft targets s (shootout-aware)
I=np.array([idx[mm['h']] for mm in M]); J=np.array([idx[mm['a']] for mm in M])
S=np.empty(len(M)); Wt=np.array([mm['w'] for mm in M])
for k,mm in enumerate(M):
    if mm['hs']>mm['as_']: S[k]=1.0
    elif mm['hs']<mm['as_']: S[k]=0.0
    else:
        win=sh.get(mm['key'])
        S[k]=SHOOTOUT_WIN if win==mm['h'] else ((1-SHOOTOUT_WIN) if win==mm['a'] else 0.5)

# ---------- 3) MAP Bradley-Terry: shrink toward Elo prior (concave) ----------
inv_var=1.0/PRIOR_SIGMA**2
def negpost(th):
    d=th[I]-th[J]; p=1/(1+np.exp(-d))
    p=np.clip(p,1e-12,1-1e-12)
    ll=np.sum(Wt*(S*np.log(p)+(1-S)*np.log(1-p)))
    pen=0.5*inv_var*np.sum((th-m)**2)
    g=np.zeros(n); diff=Wt*(p-S)
    np.add.at(g,I,diff); np.add.at(g,J,-diff)
    g+=inv_var*(th-m)
    return -(ll-pen), g
res=minimize(negpost,m.copy(),jac=True,method='L-BFGS-B',options={'maxiter':2000})
theta=res.x

# tau for FUSION = recent-evidence Fisher info (+floor). Deliberately NOT 1/sigma^2:
# theta is tightly Elo-anchored for accuracy, but tau must stay modest so the
# user's ~40 picks can still perturb the prior (else the user is muted).
tau=np.full(n,TAU_FLOOR)
for k in range(len(M)):
    p=1/(1+math.exp(-(theta[I[k]]-theta[J[k]]))); info=Wt[k]*p*(1-p)
    tau[I[k]]+=info; tau[J[k]]+=info

# Poisson link calibration
H=np.array([0.0 if mm['neutral'] else 1.0 for mm in M])
dth=theta[I]-theta[J]; hs=np.array([mm['hs'] for mm in M],float); as_=np.array([mm['as_'] for mm in M],float)
def nll(p):
    mu,home,sc=p; lh=np.exp(mu+home*H+sc*dth); la=np.exp(mu-sc*dth)
    return -(Wt*((hs*np.log(lh)-lh)+(as_*np.log(la)-la))).sum()
mu,home_adv,scale=minimize(nll,[0.,0.3,0.5],method='Nelder-Mead',
                           options={'xatol':1e-5,'fatol':1e-5,'maxiter':8000}).x

order=np.argsort(-theta)
out={"meta":{"source":"martj42/international_results (CC BY) + shootouts",
      "prior_anchor":"World Football Elo computed over full match history",
      "prior_sigma":PRIOR_SIGMA,"window_start":START,"ref_date":REF_DATE,
      "halflife_days":HALFLIFE_DAYS,"shootout_win_credit":SHOOTOUT_WIN,
      "weighted_matches":len(M),"teams":n,
      "note":"theta = MAP Bradley-Terry shrunk TIGHTLY toward World Football Elo (best backtest); tau = recent-evidence precision used as the user-agency weight in fusion (not the prior statistical precision)"},
     "link":{"mu":round(float(mu),4),"home_adv":round(float(home_adv),4),"scale":round(float(scale),4)},
     "teams":[{"name":teams[i],"theta":round(float(theta[i]),4),"tau":round(float(tau[i]),3)} for i in order]}
json.dump(out,open('theta_data.json','w'),indent=2,ensure_ascii=False)

# teams.json (unchanged logic)
wcg=[r for r in rows if r['tournament']=='FIFA World Cup' and START<=r['date']<='2026-06-27']
gadj=defaultdict(set)
for r in wcg: gadj[r['home_team']].add(r['away_team']); gadj[r['away_team']].add(r['home_team'])
gseen=set(); groups=[]
for s0 in sorted(gadj):
    if s0 in gseen: continue
    q=[s0]; gseen.add(s0); comp=[]
    while q:
        u=q.pop(); comp.append(u)
        for v in gadj[u]:
            if v not in gseen: gseen.add(v); q.append(v)
    groups.append(sorted(comp))
groups.sort(key=lambda g:g[0]); labels=[chr(ord('A')+k) for k in range(12)]
tg={t:labels[k] for k,g in enumerate(groups) for t in g}; allteams=sorted(tg)
json.dump({"meta":{"note":"48-team field + group membership from fixtures; group LETTERS are by-convenience, reconcile with official draw for R32."},
           "teams":[{"id":i,"name":t,"group":tg[t]} for i,t in enumerate(allteams)]},
          open('teams.json','w'),indent=2,ensure_ascii=False)

print("=== World Football Elo (current, top 12) ===")
for t in sorted(teams,key=lambda t:-elo[t])[:12]: print(f"  {elo[t]:6.0f}  {t}")
print(f"\nlink: mu={mu:.3f} home_adv={home_adv:.3f} scale={scale:.3f}   prior_sigma={PRIOR_SIGMA}")
print("\n=== theta after shrinking toward Elo (top 16) ===")
for i in order[:16]: print(f"  {theta[i]:+.3f}  tau={tau[i]:4.1f}  {teams[i]}")
print(f"\nFrance rank {list(order).index(idx['France'])+1}  |  Senegal rank {list(order).index(idx['Senegal'])+1}")
