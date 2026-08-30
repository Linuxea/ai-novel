import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AppProviders } from "@/app/providers";

function QueryClientProbe({
  onClient,
}: {
  readonly onClient: (client: ReturnType<typeof useQueryClient>) => void;
}) {
  const client = useQueryClient();
  useEffect(() => onClient(client), [client, onClient]);
  return null;
}

describe("应用 QueryClientProvider", () => {
  it("跨根布局重渲染保持同一个 QueryClient", () => {
    const clients: ReturnType<typeof useQueryClient>[] = [];
    const onClient = (client: ReturnType<typeof useQueryClient>) => {
      clients.push(client);
    };
    const view = render(
      <AppProviders>
        <QueryClientProbe onClient={onClient} />
      </AppProviders>,
    );

    view.rerender(
      <AppProviders>
        <QueryClientProbe onClient={onClient} />
      </AppProviders>,
    );

    expect(clients.length).toBeGreaterThanOrEqual(1);
    expect(new Set(clients).size).toBe(1);
  });
});
