from pathlib import Path
import subprocess

ROOT = Path(__file__).resolve().parents[1]
FRONTEND = ROOT / "frontend/pulseboard-web"


def replace_once(relative: str, old: str, new: str) -> None:
    path = ROOT / relative
    text = path.read_text(encoding="utf-8")
    if text.count(old) != 1:
        raise SystemExit(f"{relative}: expected one replacement anchor, found {text.count(old)}")
    path.write_text(text.replace(old, new), encoding="utf-8")


replace_once(
    "frontend/pulseboard-web/src/components/ConnectionStatus.vue",
    """const props = defineProps<{
  onReconnect?: () => void
  reconnectAttempts?: number
}>()
""",
    """const props = withDefaults(defineProps<{
  onReconnect?: () => void
  reconnectAttempts?: number
}>(), {
  reconnectAttempts: 0,
})
""",
)

replace_once(
    "frontend/pulseboard-web/src/views/DashboardLiveView.vue",
    "import { useUiStore } from '../stores/ui'\n",
    "",
)
replace_once(
    "frontend/pulseboard-web/src/views/DashboardLiveView.vue",
    "const uiStore = useUiStore()\n",
    "",
)
replace_once(
    "frontend/pulseboard-web/src/views/DashboardLiveView.vue",
    "const wsStatus = computed(() => uiStore.wsStatus)\n",
    "",
)

replace_once(
    "frontend/pulseboard-web/src/stores/dashboards.ts",
    """        await apiClient.createPanel(clonedDashboard.id, {
          title: panel.title,
          type: panel.type,
          config_json: panel.config_json,
          position: panel.position,
        })
""",
    """        await apiClient.createPanel(clonedDashboard.id, {
          title: panel.title,
          type: panel.type,
          feed_ids_json: panel.feed_ids_json,
          options_json: panel.options_json,
          position_x: panel.position_x,
          position_y: panel.position_y,
          width: panel.width,
          height: panel.height,
        })
""",
)

subprocess.run(["npx", "vitest", "run", "--maxWorkers=2"], cwd=FRONTEND, check=True)
subprocess.run(["npm", "run", "build"], cwd=FRONTEND, check=True)
subprocess.run(["git", "diff", "--check"], cwd=ROOT, check=True)

(ROOT / ".github/workflows/tmp-frontend-source-fix.yml").unlink()
Path(__file__).unlink()
subprocess.run(["git", "config", "user.name", "github-actions[bot]"], cwd=ROOT, check=True)
subprocess.run(["git", "config", "user.email", "41898282+github-actions[bot]@users.noreply.github.com"], cwd=ROOT, check=True)
subprocess.run(["git", "add", "-A"], cwd=ROOT, check=True)
subprocess.run(["git", "commit", "-m", "Fix remaining frontend production type errors"], cwd=ROOT, check=True)
subprocess.run(["git", "push", "origin", "HEAD:fix/frontend-gates-13"], cwd=ROOT, check=True)
