
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
  view.className = "view hero";
  const alive = liveCheck();
  const draw = async () => {
    const holders = Object.keys(S.team);
    const ps = await (S.user ? S.user.profiles(holders).catch(() => ({})) : {});
    if (!alive()) return;
    const err = h("p", { class: "err", hidden: true, role: "alert", style: "margin-top:10px" });
    // the roster name that matches this Claude account goes first
    const mine = str(S.me?.name).toLowerCase();
    const names = [...roster()].sort((a, b) => (mine.startsWith(b.toLowerCase()) ? 1 : 0) - (mine.startsWith(a.toLowerCase()) ? 1 : 0));
    view.replaceChildren(h("div", { class: "signin" },
      h("div", { class: "brand" }, h("span", { class: "logo", "aria-hidden": "true" }, svg(IC.spark, 15)), h("b", null, "Starwell"), h("small", null, "SI")),
      h("section", { class: "si-card", "aria-labelledby": "si-h" },
        h("h1", { id: "si-h" }, "Who's signing in?"),
        h("p", null, S.me?.name ? ["Signed in to Claude as ", h("b", { style: "color:var(--fg);font-weight:500" }, S.me.name)] : "Pick your name once."),
        h("div", { class: "seats" }, names.map((name) => {
          const holder = holderOf(name);
          const taken = holder && holder !== S.uid;
          return h("button", { class: "seat", type: "button", disabled: !!taken, "aria-describedby": taken ? "seat-" + name : null, onclick: () => claimSeat(name, err) },
            h("span", { class: "av lg", "aria-hidden": "true" }, initials(name)),
            h("span", { style: "min-width:0" }, h("b", null, name), taken ? h("small", { id: "seat-" + name }, "Already signed in on " + (ps[holder]?.name || "another account")) : null),
            taken ? svg(IC.lock) : svg(IC.chevR));
        })), err),
      h("p", { class: "si-foot" }, "Not on the list? Ask whoever shared this page to add you.")));
  };
  currentView.refresh = draw; draw();
}

function viewTeam(view) {
  const alive = liveCheck();
  const draw = async () => {
    const holders = Object.keys(S.team);
    const ps = await (S.user ? S.user.profiles(holders).catch(() => ({})) : {});
    const isOwner = await S.user?.isOwner?.().catch(() => false);
    if (!alive()) return;
    const names = [...new Set([...roster(), ...Object.values(S.team).map((t) => t.name)])];
    const add = h("input", { class: "inp", placeholder: "Teammate's name", "aria-label": "New teammate name", style: "max-width:240px" });
    view.replaceChildren(
      pageHead("Team"),
      h("div", { class: "table team-t" },
        h("div", { class: "thead", role: "presentation" }, h("span", null, "Name"), h("span", { class: "c" }, "Claude account"), h("span", { class: "c r" }, "Memos"), h("span", { class: "c" }, "Last upload"), h("span", { class: "c" }, "Status"), h("span")),
        names.map((name) => {
          const uid = holderOf(name);
          const mine = S.memos.filter((m) => uid && m.ownerId === uid);
          const last = mine[0];
          const canUnlink = uid && (uid === S.uid || isOwner);
          const canRemove = !uid && S.can.review && roster().includes(name);
          return h("div", { class: "lrow" },
            h("div", { class: "row" }, uid && ps[uid]?.avatarUrl ? h("img", { class: "av md", src: ps[uid].avatarUrl, alt: "" }) : h("span", { class: "av md", "aria-hidden": "true" }, initials(name)), h("h3", null, name + (uid === S.uid ? " (you)" : ""))),
            h("span", { class: "c" }, uid ? ps[uid]?.name || "Linked" : "—"),
            h("span", { class: "c r num" }, uid ? mine.length : "—"),
            h("span", { class: "c" }, last ? fmtWhen(last.createdAt) : "—"),
            h("span", { class: "c keep" }, uid ? h("span", { class: "state ok" }, h("i", { class: "dot" }), "Signed in") : h("span", { class: "state" }, h("i", { class: "dot" }), "Hasn't signed in yet")),
            canUnlink || canRemove ? menuButton(h("button", { class: "icon-btn sm", type: "button", "aria-label": "Options for " + name }, svg(IC.more)), () => [
              canUnlink ? menuItem(uid === S.uid ? "Not me: unlink my account" : "Unlink this account", () => unclaimSeat(uid), { icon: IC.swap }) : null,
              canRemove ? menuItem("Remove from the team list", () => saveRoster(roster().filter((n) => n !== name)), { icon: IC.trash, danger: true }) : null]) : h("span"));
        })),
      S.can.review ? h("form", { class: "row", style: "margin-top:12px;flex-wrap:wrap", onsubmit: (e) => { e.preventDefault(); const n = str(add.value); if (!n || names.some((x) => x.toLowerCase() === n.toLowerCase())) return; saveRoster([...roster(), n]); } }, add, h("button", { class: "btn", type: "submit" }, svg(IC.plus), "Add teammate")) : null,
      h("details", { class: "fold flat", style: "margin-top:20px" }, h("summary", null, h("span", null, "How to give a teammate access")),
        h("div", { class: "fold-b" }, h("ol", { class: "plain", style: "font-size:14px;line-height:22px" },
          h("li", null, "Open the page's Share menu (top right of the page in Claude)."),
          h("li", null, "Invite them by email. Choose Editor if they should accept or reject findings; Contributor if they only upload and comment."),
          h("li", null, "They open the link, sign in to Claude with their own account, and pick their name.")),
          h("p", { class: "hint", style: "margin-top:10px" }, "Each person needs their own Claude account. Analysis runs on the account of whoever uploads the memo."))));
  };
  currentView.refresh = draw; draw();
}
async function saveRoster(members) {
  try { await S.db.doc("settings/team").set({ members, at: Date.now(), by: S.uid }); toast("Team list saved"); }
  catch { toast("Only Editors of this page can change the team list."); }
}

function viewMine(view) {
  const alive = liveCheck();
  const draw = async () => {
    const mine = S.memos.filter((m) => m.ownerId === S.uid);
    const ps = await people([S.uid]);
    if (!alive()) return;
    view.replaceChildren(
      pageHead("My uploads", null, S.can.write && S.companies.length ? h("a", { class: "btn primary", href: "#new" }, svg(IC.plus), "New memo") : null),
      mine.length ? memoTable(mine, ps, { company: true }) : emptyState(IC.upload, "You haven't uploaded a memo yet", "Memos you upload show up here, across every company.", S.can.write && S.companies.length ? h("a", { class: "btn primary", href: "#new" }, "Upload your first memo") : null));
  };
  currentView.refresh = draw; draw();
}
