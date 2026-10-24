import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { BriefCard } from "./BriefCard";
import { BRIEF_SYSTEM_TITLE, type BriefListItem } from "@/lib/briefs";
import { az } from "@/lib/i18n/az";

const brief: BriefListItem = {
  id: "preview",
  date: "2026-10-23",
  title: "Legacy title",
  summary: "Əməkdaşın hazırladığı xülasə.",
  status: "published",
  indexStatus: "ready",
  indexProgress: { percent: 100, totalChunks: 1, completedChunks: 1 },
  photoCount: 0,
};

describe("bulletin summary card", () => {
  it("shows the fixed title, prominent date and manual summary", () => {
    render(<BriefCard brief={brief} preview />);
    expect(screen.getByRole("heading", { name: BRIEF_SYSTEM_TITLE })).toBeInTheDocument();
    expect(screen.getByText("23")).toBeInTheDocument();
    expect(screen.getByText(brief.summary!)).toHaveClass(
      "line-clamp-4",
      "text-sm",
      "leading-[1.6]",
    );
    expect(screen.queryByText(brief.title)).toBeNull();
  });

  it.each([null, "", "  "])(
    "uses a neutral empty state for summary=%s without a body fallback",
    (summary) => {
      render(
        <BriefCard
          brief={{ ...brief, summary, ...{ body: "1. SECRET BODY", excerpt: "OLD EXCERPT" } }}
          preview
        />,
      );
      expect(screen.getByText(az.briefs.summaryEmpty)).toBeInTheDocument();
      expect(screen.queryByText(/SECRET BODY|OLD EXCERPT/)).toBeNull();
    },
  );
});
