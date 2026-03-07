/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TagBadge } from "./TagBadge";

const baseTag = { id: 1, name: "Production", colour: "#ff0000" };

describe("TagBadge", () => {
  it("renders the tag name", () => {
    render(<TagBadge tag={baseTag} />);
    expect(screen.getByText("Production")).toBeInTheDocument();
  });

  it("renders the colour dot with the correct background", () => {
    const { container } = render(<TagBadge tag={baseTag} />);
    const dot = container.querySelector("span > span:first-child");
    expect(dot).toHaveStyle({ backgroundColor: "#ff0000" });
  });

  it("truncates long names and shows a title tooltip", () => {
    const longTag = { id: 2, name: "A very long tag name that exceeds twenty characters", colour: "#00f" };
    render(<TagBadge tag={longTag} />);
    expect(screen.getByText("A very long tag name...")).toBeInTheDocument();
    const badge = screen.getByTitle("A very long tag name that exceeds twenty characters");
    expect(badge).toBeInTheDocument();
  });

  it("does not show remove button when onRemove is not provided", () => {
    render(<TagBadge tag={baseTag} />);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("shows remove button when onRemove is provided", () => {
    render(<TagBadge tag={baseTag} onRemove={() => {}} />);
    expect(screen.getByLabelText("Remove tag Production")).toBeInTheDocument();
  });

  it("calls onRemove when remove button is clicked", async () => {
    const user = userEvent.setup();
    const onRemove = vi.fn();
    render(<TagBadge tag={baseTag} onRemove={onRemove} />);
    await user.click(screen.getByLabelText("Remove tag Production"));
    expect(onRemove).toHaveBeenCalledOnce();
  });
});
