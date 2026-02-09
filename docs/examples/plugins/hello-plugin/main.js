export async function activate(ctx) {
  ctx.commands.register({
    id: "hello.demo.sayHello",
    title: "Hello Demo: Say Hello",
    run: () => {
      ctx.log("Hello from the demo plugin");
    }
  });

  const panelMarkdown = await ctx.assets.readText("ui/panel.md");
  const logoUrl = await ctx.assets.getUrl("assets/hello.svg");
  ctx.panels.register({
    id: "hello.panel.runtime",
    title: "Hello Panel (Runtime)",
    schema: {
      type: "markdown",
      props: {
        content: `${panelMarkdown}\n\n![Hello](${logoUrl})\n\nThis panel was registered at runtime.`
      }
    }
  });
}

export function deactivate() {
  // optional cleanup
}
