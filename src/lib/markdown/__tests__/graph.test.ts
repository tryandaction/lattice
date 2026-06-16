import { describe, expect, it } from "vitest";
import { buildMarkdownLinkIndex } from "../link-index";
import { buildLocalMarkdownGraph, buildMarkdownGraph } from "../graph";

describe("markdown graph", () => {
  it("builds directed note graph from resolved markdown links", () => {
    const index = buildMarkdownLinkIndex([
      {
        path: "notes/a.md",
        content: "Links [[b]] and [C](c.md) and [Missing](missing.md).",
      },
      {
        path: "notes/b.md",
        content: "See [[c]].",
      },
      {
        path: "notes/c.md",
        content: "# C",
      },
    ]);

    const graph = buildMarkdownGraph(index);

    expect(graph.nodes.map((node) => node.path)).toEqual([
      "notes/a.md",
      "notes/b.md",
      "notes/c.md",
    ]);
    expect(graph.edges.map((edge) => `${edge.source}->${edge.target}`)).toEqual([
      "notes/a.md->notes/b.md",
      "notes/a.md->notes/c.md",
      "notes/b.md->notes/c.md",
    ]);
    expect(graph.nodes.find((node) => node.path === "notes/a.md")).toMatchObject({
      outgoing: 2,
      incoming: 0,
      degree: 2,
    });
    expect(graph.nodes.find((node) => node.path === "notes/c.md")).toMatchObject({
      outgoing: 0,
      incoming: 2,
      degree: 2,
    });
  });

  it("can include broken links as graph leaves", () => {
    const index = buildMarkdownLinkIndex([
      {
        path: "notes/a.md",
        content: "Links [Missing](missing.md).",
      },
    ]);

    const graph = buildMarkdownGraph(index, { includeBroken: true });

    expect(graph.nodes).toHaveLength(2);
    expect(graph.nodes.some((node) => node.broken && node.path.includes("missing.md"))).toBe(true);
    expect(graph.edges).toEqual([
      expect.objectContaining({
        source: "notes/a.md",
        rawTarget: "missing.md",
        broken: true,
      }),
    ]);
  });

  it("builds a local graph around a center file with depth", () => {
    const index = buildMarkdownLinkIndex([
      {
        path: "notes/a.md",
        content: "[[b]]",
      },
      {
        path: "notes/b.md",
        content: "[[c]]",
      },
      {
        path: "notes/c.md",
        content: "[[d]]",
      },
      {
        path: "notes/d.md",
        content: "# D",
      },
    ]);

    const graph = buildMarkdownGraph(index);
    const local = buildLocalMarkdownGraph(graph, "notes/b.md", 1);

    expect(local.nodes.map((node) => node.path)).toEqual([
      "notes/a.md",
      "notes/b.md",
      "notes/c.md",
    ]);
    expect(local.edges.map((edge) => `${edge.source}->${edge.target}`)).toEqual([
      "notes/a.md->notes/b.md",
      "notes/b.md->notes/c.md",
    ]);
  });
});
