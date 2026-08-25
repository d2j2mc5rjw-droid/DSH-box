window.__ModuleLoader__.load({
	id: "@yyb/dsh-box-update",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		const react = require("react");

		function UpdateCard() {
			const [state, setState] = react.useState({ status: "idle" });
			const box = typeof window !== "undefined" ? window.dshBox : undefined;

			async function check() {
				if (!box) return;
				setState({ status: "checking" });
				try {
					const r = await box.checkUpdate();
					if (r && r.error) setState({ status: "error", msg: r.error });
					else if (r && r.latest && r.latest !== r.current) setState({ status: "available", latest: r.latest, url: r.url });
					else setState({ status: "latest", current: r && r.current });
				} catch (e) {
					setState({ status: "error", msg: String(e && e.message || e) });
				}
			}

			const btn = {
				border: "1px solid rgba(232,200,119,.45)",
				borderRadius: 8,
				padding: "5px 14px",
				fontSize: 12,
				cursor: "pointer",
				color: "#f0ce74",
				background: "rgba(232,200,119,.08)"
			};
			const link = Object.assign({}, btn, { color: "#9ecbff", borderColor: "rgba(120,170,255,.4)", background: "rgba(120,170,255,.08)" });

			return react.createElement(
				"div",
				{ style: { display: "flex", flexDirection: "column", gap: 6, padding: "2px 0" } },
				react.createElement("div", { style: { fontSize: 13, fontWeight: 600 } }, "DSH-box 更新"),
				react.createElement(
					"div",
					{ style: { fontSize: 12, opacity: .65 } },
					box
						? `当前版本 ${box.version} · 检查桌面壳的新版本`
						: "仅在 DSH-box 桌面应用内可用"
				),
				react.createElement(
					"div",
					{ style: { display: "flex", gap: 8, alignItems: "center", marginTop: 2 } },
					box && react.createElement(
						"button",
						{ style: btn, onClick: check, disabled: state.status === "checking" },
						state.status === "checking" ? "检查中…" : "检查更新"
					),
					state.status === "latest" && react.createElement("span", { style: { fontSize: 12, opacity: .7 } }, `已是最新（${state.current || box.version}）`),
					state.status === "available" && react.createElement("span", { style: { fontSize: 12, color: "#f0ce74" } }, `发现新版本 v${state.latest}`),
					state.status === "available" && react.createElement(
						"button",
						{ style: link, onClick: () => (state.url ? window.open(state.url, "_blank") : box.openReleases()) },
						"前往下载"
					),
					state.status === "error" && react.createElement("span", { style: { fontSize: 12, color: "#d98c8c" } }, state.msg)
				)
			);
		}

		Object.assign(exports, {
			inject: ["slots"],
			apply(ctx) {
				if (typeof window === "undefined" || !window.dshBox) return;
				ctx.slots.inject("settings.plugin.item", () =>
					ctx.slots.register(
						{ name: "settings.plugin.item", id: "dsh-box-update", key: "dsh-box-update", order: 1 },
						UpdateCard,
					),
				);
			},
		});
		return module.exports;
	},
});
