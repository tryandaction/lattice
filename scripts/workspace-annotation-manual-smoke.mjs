const sections = [
  {
    title: "Web: child workspace annotations remain visible from parent workspace",
    steps: [
      "Open the workspace folder that directly contains the file, for example C:/universe/Course/electives/statistics.",
      "Open a PDF or markdown file and create at least one annotation.",
      "Close the workspace and reopen the parent folder, for example C:/universe/Course.",
      "Open the same file from the parent workspace.",
    ],
    expected: [
      "The existing annotations are visible without creating a duplicate sidecar manually.",
      "The file does not lose annotations when the root changes from child to parent.",
    ],
  },
  {
    title: "Web: explicit workspace switching does not bounce back to the parent folder",
    steps: [
      "Open the parent workspace.",
      "In the explorer, right click a child directory and choose 'Open as Workspace'.",
      "Wait for the workspace to reload.",
    ],
    expected: [
      "The active workspace stays on the selected child directory.",
      "Auto restore does not switch back to the previous parent root.",
    ],
  },
  {
    title: "Desktop: PDF stays stable until annotation mode is explicitly entered",
    steps: [
      "Open a large PDF in the desktop app.",
      "Verify the file opens in the lightweight viewer first.",
      "Enter annotation mode manually.",
    ],
    expected: [
      "The PDF opens without immediate freezes.",
      "Existing annotations load after entering annotation mode.",
    ],
  },
  {
    title: "Move / rename: annotations follow the file",
    steps: [
      "Create an annotation for a file inside the current workspace.",
      "Rename the file inside Lattice, or move it to another directory inside the same workspace.",
      "Reopen the file from the new path.",
    ],
    expected: [
      "The annotation sidecar follows the new file path.",
      "The reopened file shows the existing annotations from the old path.",
    ],
  },
  {
    title: "Conflict guard: path reuse should not silently attach old annotations",
    steps: [
      "Annotate a file, then replace it with a different file at the same path outside the app.",
      "Reopen the workspace and open the reused path.",
    ],
    expected: [
      "The app should not silently auto bind annotations from a different fingerprint owner when the registry detects multiple path owners.",
      "If a mismatch is detected, treat it as a conflict instead of reusing the stale annotation set.",
    ],
  },
];

console.log("Lattice workspace annotation manual smoke checklist");
console.log("=".repeat(48));
console.log("");

sections.forEach((section, index) => {
  console.log(`${index + 1}. ${section.title}`);
  console.log("   Steps:");
  section.steps.forEach((step) => {
    console.log(`   - ${step}`);
  });
  console.log("   Expected:");
  section.expected.forEach((expectation) => {
    console.log(`   - ${expectation}`);
  });
  console.log("");
});
