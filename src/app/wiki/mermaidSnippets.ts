export interface MermaidSnippet {
  readonly label: string;
  readonly code: string;
}

// Compact, valid starter diagrams for each Mermaid type PowerWiki renders.
// Inserted as fenced ```mermaid blocks so they round-trip through the standard
// Azure DevOps Wiki as portable Markdown. Shared by the editor toolbar's Mermaid
// menu and the slash-command palette.
export const MERMAID_SNIPPETS: readonly MermaidSnippet[] = [
  {
    label: "Flowchart",
    code: [
      "flowchart TD",
      "    A[Start] --> B{Decision}",
      "    B -->|Yes| C[Do this]",
      "    B -->|No| D[Do that]",
      "    C --> E[End]",
      "    D --> E",
    ].join("\n"),
  },
  {
    label: "Sequence diagram",
    code: [
      "sequenceDiagram",
      "    participant A as Alice",
      "    participant B as Bob",
      "    A->>B: Hello Bob, how are you?",
      "    B-->>A: Great, thanks!",
    ].join("\n"),
  },
  {
    label: "Class diagram",
    code: [
      "classDiagram",
      "    class Animal {",
      "        +String name",
      "        +move()",
      "    }",
      "    Animal <|-- Dog",
      "    Animal <|-- Cat",
    ].join("\n"),
  },
  {
    label: "State diagram",
    code: [
      "stateDiagram-v2",
      "    [*] --> Idle",
      "    Idle --> Running: start",
      "    Running --> Idle: stop",
      "    Running --> [*]",
    ].join("\n"),
  },
  {
    label: "Entity relationship",
    code: [
      "erDiagram",
      "    CUSTOMER ||--o{ ORDER : places",
      "    ORDER ||--|{ LINE_ITEM : contains",
      "    CUSTOMER }|..|{ ADDRESS : uses",
    ].join("\n"),
  },
  {
    label: "User journey",
    code: [
      "journey",
      "    title My working day",
      "    section Go to work",
      "      Make tea: 5: Me",
      "      Commute: 3: Me",
      "    section Work",
      "      Do work: 1: Me",
    ].join("\n"),
  },
  {
    label: "Gantt chart",
    code: [
      "gantt",
      "    title Project schedule",
      "    dateFormat YYYY-MM-DD",
      "    section Planning",
      "      Research      :a1, 2024-01-01, 7d",
      "      Design        :after a1, 5d",
      "    section Build",
      "      Implementation:after a1, 10d",
    ].join("\n"),
  },
  {
    label: "Pie chart",
    code: [
      "pie title Pets adopted by volunteers",
      '    "Dogs" : 45',
      '    "Cats" : 30',
      '    "Birds" : 25',
    ].join("\n"),
  },
  {
    label: "Quadrant chart",
    code: [
      "quadrantChart",
      "    title Reach and engagement",
      "    x-axis Low Reach --> High Reach",
      "    y-axis Low Engagement --> High Engagement",
      "    Campaign A: [0.3, 0.6]",
      "    Campaign B: [0.7, 0.4]",
    ].join("\n"),
  },
  {
    label: "Mindmap",
    code: [
      "mindmap",
      "  root((PowerWiki))",
      "    Rendering",
      "      Markdown",
      "      Mermaid",
      "    Editing",
      "      Monaco",
    ].join("\n"),
  },
  {
    label: "Timeline",
    code: [
      "timeline",
      "    title Product history",
      "    2021 : Idea",
      "    2022 : Prototype",
      "    2023 : Launch",
    ].join("\n"),
  },
  {
    label: "Git graph",
    code: [
      "gitGraph",
      "    commit",
      "    branch develop",
      "    checkout develop",
      "    commit",
      "    checkout main",
      "    merge develop",
    ].join("\n"),
  },
  {
    label: "Architecture",
    code: [
      "architecture-beta",
      "    group api(cloud)[API]",
      "    service db(database)[Database] in api",
      "    service server(server)[Server] in api",
      "    db:L -- R:server",
    ].join("\n"),
  },
  {
    label: "Block",
    code: [
      "block-beta",
      "    columns 3",
      '    a["A"] b["B"] c["C"]',
      "    d[\"D\"] space e[\"E\"]",
    ].join("\n"),
  },
  {
    label: "Kanban",
    code: [
      "kanban",
      "    Todo",
      "        t1[Design the feature]",
      "    In progress",
      "        t2[Build it]",
      "    Done",
      "        t3[Ship it]",
    ].join("\n"),
  },
  {
    label: "Sankey",
    code: [
      "sankey-beta",
      "    Source,Middle,5",
      "    Middle,Target A,3",
      "    Middle,Target B,2",
    ].join("\n"),
  },
  {
    label: "XY chart",
    code: [
      "xychart-beta",
      '    title "Monthly revenue"',
      "    x-axis [jan, feb, mar, apr]",
      '    y-axis "Revenue" 0 --> 100',
      "    bar [30, 50, 80, 65]",
    ].join("\n"),
  },
  {
    label: "Requirement",
    code: [
      "requirementDiagram",
      "    requirement req1 {",
      "        id: 1",
      "        text: The system shall render diagrams.",
      "        risk: medium",
      "        verifymethod: test",
      "    }",
      "    element e1 {",
      "        type: simulation",
      "    }",
      "    e1 - verifies -> req1",
    ].join("\n"),
  },
];
