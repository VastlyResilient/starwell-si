
// =====================================================================================
// Accounts: each teammate signs in with their own Claude account and links it to their name once.
// The link lives at team/<their account id>; the server only lets a person write their own link.
// =====================================================================================
const DEFAULT_ROSTER = ["Bobby", "Dan", "RJ"];
const roster = () => arr(S.roster).length ? S.roster : DEFAULT_ROSTER;
const myName = () => S.team[S.uid]?.name || "";
const holderOf = (name) => Object.entries(S.team).find(([, t]) => t.name === name)?.[0] || null;
const needsSignIn = () => S.ready && !!S.db && !!S.uid && S.can.write && !S.team[S.uid];

async function claimSeat(name, err) {
  const holder = holderOf(name);
  if (holder && holder !== S.uid) { err.textContent = `${name} is already linked to another Claude account. If that's wrong, ask the page owner to unlink it on the Team page.`; err.hidden = false; return; }
  try {
    await S.db.doc("team/" + S.uid).set({ name, at: Date.now() });
    toast("Signed in as " + name);
  } catch { err.textContent = "Couldn't save. You may only have view access; ask Bobby to share the page with you as an Editor or Contributor."; err.hidden = false; }
}
async function unclaimSeat(uid) {
  try { await S.db.doc("team/" + uid).delete(); } catch { toast("Only that person or the page owner can unlink this account."); }
}
function viewSignIn(view) {
  view.className = "view wide enter";
  setTimeout(() => view.classList.remove("enter"), 2400);
  const draw = async () => {
    const holders = Object.keys(S.team);
    const ps = await (S.user ? S.user.profiles(holders).catch(() => ({})) : {});
    const err = h("p", { class: "err", hidden: true, role: "alert", style: "padding:6px 4px 0" });
    view.replaceChildren(h("div", { class: "hero" },
      h("nav", { class: "hero-nav", "aria-label": "Starwell" }, h("span", { class: "wordmark" }, h("b", null, "Starwell", h("sup", null, "SI"))),
        h("span", { class: "hero-who" }, "Claude account: ", h("b", null, S.me?.name || "this account"))),
      h("h1", null, "Every interview, organized\ninto clear, useful insight"),
      h("p", null, "Voice memos and notes become findings linked to the exact words.\nPick your name to get started."),
      h("div", { class: "band hero-band", role: "presentation" }),
      h("section", { class: "band-card", "aria-label": "Sign in" },
        h("div", { class: "bc-eyebrow" }, "# Starwell SI / Team sign-in"),
        h("div", { class: "bc-title" }, "Who's signing in?"),
        h("div", { class: "bc-panel" }, h("h3", null, "Choose your name"),
          roster().map((name) => {
            const holder = holderOf(name);
            const taken = holder && holder !== S.uid;
            return h("button", { class: "brow seat seat-row", type: "button", disabled: !!taken, onclick: () => claimSeat(name, err) },
              h("span", { class: "av", "aria-hidden": "true" }, initials(name)),
              h("span", { style: "min-width:0" }, h("b", null, name), h("small", null, taken ? "Already signed in on " + (ps[holder]?.name || "another account") : "Links to the Claude account you're using now")),
              taken ? statusIcon("accepted") : h("span", { class: "go" }, "Sign in →"));
          }), err),
        h("p", { style: "font-size:12.5px;color:#6b6b6b;margin:10px 4px 2px;letter-spacing:-0.01em" }, "Not you? Sign out of Claude, sign back in with your own account, then open this link again."))));
  };
  currentView.refresh = draw; draw();
}

function viewTeam(view) {
  view.className = "view";
  const draw = async () => {
    const holders = Object.keys(S.team);
    const ps = await (S.user ? S.user.profiles(holders).catch(() => ({})) : {});
    const isOwner = await S.user?.isOwner?.().catch(() => false);
    const names = [...new Set([...roster(), ...Object.values(S.team).map((t) => t.name)])];
    const add = h("input", { class: "inp", placeholder: "Add a teammate's name", "aria-label": "New teammate name", style: "max-width:260px" });
    view.replaceChildren(
      h("div", { class: "page-h" }, h("div", null, h("h1", null, "Team"), h("p", null, "Everyone on this list signs in with their own Claude account. Every memo they upload, with its full transcript and notes, is shared with the whole team."))),
      h("div", { class: "list" }, names.map((name) => {
        const uid = holderOf(name);
        const mine = S.memos.filter((m) => uid && m.ownerId === uid);
        const last = mine[0];
        return h("div", { class: "lrow", style: "grid-template-columns:minmax(0,1fr) auto" },
          h("div", { style: "display:flex;gap:12px;align-items:center;min-width:0" }, uid && ps[uid]?.avatarUrl ? h("img", { src: ps[uid].avatarUrl, alt: "", style: "width:34px;height:34px;border-radius:50%" }) : h("span", { class: "mono-badge" }, initials(name)),
            h("div", { style: "min-width:0" }, h("h3", null, name + (uid === S.uid ? " (you)" : "")),
              h("small", null, uid ? [`Claude account: ${ps[uid]?.name || "linked"}`, `${mine.length} memo${mine.length === 1 ? "" : "s"}`, last ? "last upload " + fmtWhen(last.createdAt) : null].filter(Boolean).join(" · ") : "Hasn't signed in yet"))),
          h("div", { style: "display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end" },
            uid ? h("span", { class: "chip c-ok" }, h("i"), "Signed in") : h("span", { class: "chip c-line" }, "Waiting"),
            uid && (uid === S.uid || isOwner) ? h("button", { class: "btn ghost sm", type: "button", onclick: () => unclaimSeat(uid) }, uid === S.uid ? "Not me" : "Unlink") : null,
            !uid && S.can.review && roster().includes(name) ? h("button", { class: "btn ghost sm", type: "button", onclick: () => saveRoster(roster().filter((n) => n !== name)) }, "Remove") : null));
      })),
      S.can.review ? h("form", { class: "dactions", style: "margin-top:12px", onsubmit: (e) => { e.preventDefault(); const n = str(add.value); if (!n || names.some((x) => x.toLowerCase() === n.toLowerCase())) return; saveRoster([...roster(), n]); } }, add, h("button", { class: "btn sm", type: "submit" }, "Add teammate")) : null,
      h("section", { class: "sec" }, h("h2", null, "Giving a teammate access"),
        h("ol", { class: "plain", style: "margin-top:8px" },
          h("li", null, "Open the page's Share menu (top right of the page in Claude)."),
          h("li", null, "Invite them by email. Choose Editor if they should accept or reject findings; Contributor if they only upload and comment."),
          h("li", null, "They open the link, sign in to Claude with their own account, and pick their name here.")),
        h("p", { class: "hint", style: "margin-top:8px" }, "Each person needs their own Claude account. Analysis runs on the account of whoever uploads the memo.")));
  };
  currentView.refresh = draw; draw();
}
async function saveRoster(members) {
  try { await S.db.doc("settings/team").set({ members, at: Date.now(), by: S.uid }); toast("Team list saved"); }
  catch { toast("Only Editors of this page can change the team list."); }
}

function viewMine(view) {
  const draw = async () => {
    const mine = S.memos.filter((m) => m.ownerId === S.uid);
    const ps = await people([S.uid]);
    const byCo = new Map(); for (const m of mine) { const k = m.companyId && company(m.companyId) ? m.companyId : ""; if (!byCo.has(k)) byCo.set(k, []); byCo.get(k).push(m); }
    view.replaceChildren(
      h("div", { class: "page-h" }, h("div", null, h("h1", null, "My memos"), h("p", null, `Everything ${myName() || "you"} uploaded, across all companies. Your teammates see each of these in full.`)),
        S.can.write && S.companies.length ? h("a", { class: "btn primary", href: "#new" }, svg(IC.plus), "New memo") : null),
      mine.length ? [...byCo.entries()].map(([cid, ms]) => h("section", { class: "sec" }, h("h2", null, cid ? company(cid).name : "Not linked to a company"), h("div", { class: "list", style: "margin-top:8px" }, ms.map((m) => memoRow(m, ps)))))
        : h("div", { class: "empty" }, h("h3", null, "You haven't uploaded a memo yet"), S.can.write && S.companies.length ? h("a", { class: "btn primary", href: "#new" }, "Upload your first memo") : null));
  };
  currentView.refresh = draw; draw();
}
