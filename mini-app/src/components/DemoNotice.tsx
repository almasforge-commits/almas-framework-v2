import { MOCK_DEMO_NOTICE } from "../api/mockApi";

export function DemoNotice() {
  return (
    <p
      className="rounded-xl border border-dashed border-black/10 bg-tg-secondary/60 px-3 py-2 text-xs leading-relaxed text-tg-hint"
      data-testid="demo-notice"
    >
      {MOCK_DEMO_NOTICE}
    </p>
  );
}
