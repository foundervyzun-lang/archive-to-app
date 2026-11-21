import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ChatComposer } from "@/components/vyzun/ChatComposer";
afterEach(cleanup);
describe("chat composer", () => {
  it("keeps a message local when no chat is open", () => {
    render(<ChatComposer onBattle={vi.fn()} onLoot={vi.fn()} />);
    const input = screen.getByRole("textbox", { name: "Message" });
    fireEvent.change(input, { target: { value: "Hello from my campus" } });
    fireEvent.click(screen.getByRole("button", { name: "Send private message" }));
    expect(screen.getByRole("dialog").textContent).toContain("Nothing was sent");
    expect(input).toHaveValue("Hello from my campus");
  });
  it("sends text instantly through the live chat and clears the box", () => {
    const onSend = vi.fn().mockResolvedValue(true);
    render(<ChatComposer onBattle={vi.fn()} onLoot={vi.fn()} onSend={onSend} />);
    const input = screen.getByRole("textbox", { name: "Message" });
    fireEvent.change(input, { target: { value: "  hey!  " } });
    fireEvent.click(screen.getByRole("button", { name: "Send private message" }));
    expect(onSend).toHaveBeenCalledWith("hey!");
    expect(input).toHaveValue("");
  });
});
