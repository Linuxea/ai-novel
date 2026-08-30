import { useState } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

function CounterFixture() {
  const [count, setCount] = useState(0);

  return (
    <button type="button" onClick={() => setCount((value) => value + 1)}>
      已点击 {count} 次
    </button>
  );
}

describe("组件测试环境", () => {
  it("支持真实 DOM 交互与 React 状态更新", async () => {
    const user = userEvent.setup();
    render(<CounterFixture />);

    await user.click(screen.getByRole("button", { name: "已点击 0 次" }));

    expect(
      screen.getByRole("button", { name: "已点击 1 次" }).textContent,
    ).toBe("已点击 1 次");
  });
});
