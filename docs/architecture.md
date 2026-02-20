# Architecture

Igniter is a two-app monorepo built on shared packages. The diagram below shows how Provider, Middleman, and their Temporal workflow workers connect to shared infrastructure and the Pocket Network blockchain.

```mermaid
graph TD
    %% User personas
    Operators["Operators"]
    Delegators["Stakeholders / Delegators"]

    %% Apps
    Provider["Provider\n(Next.js)\nKeys · Address Groups\nRelay Miners · Delegators\nSupplier Lifecycle"]
    Middleman["Middleman\n(Next.js)\nStaking · Unstaking\nImport Suppliers\nOverview Dashboard"]

    %% Workflow workers
    ProviderWorker["Provider Workflows\n(Temporal Worker)"]
    MiddlemanWorker["Middleman Workflows\n(Temporal Worker)"]

    %% Shared packages
    subgraph Shared Packages
        UI["@repo/ui"]
        DB["@repo/db"]
        Commons["@repo/commons"]
        Domain["@repo/domain"]
        GraphQL["@repo/graphql"]
        Logger["@repo/logger"]
        Pocket["@repo/pocket"]
        Temporal["@repo/temporal"]
    end

    %% External dependencies
    PostgreSQL[("PostgreSQL")]
    TemporalServer["Temporal Server\n(Workflow Orchestration)"]
    PocketNetwork["Pocket Network\n(Shannon)"]

    %% User → App connections
    Operators --> Provider
    Delegators --> Middleman

    %% Apps → Shared packages
    Provider --> UI
    Provider --> DB
    Provider --> Commons
    Provider --> Domain
    Provider --> GraphQL
    Provider --> Logger
    Provider --> Pocket
    Provider --> Temporal

    Middleman --> UI
    Middleman --> DB
    Middleman --> Commons
    Middleman --> Domain
    Middleman --> GraphQL
    Middleman --> Logger
    Middleman --> Pocket
    Middleman --> Temporal

    %% Workflow workers → Shared packages
    ProviderWorker --> DB
    ProviderWorker --> Logger
    ProviderWorker --> Pocket
    ProviderWorker --> Temporal

    MiddlemanWorker --> DB
    MiddlemanWorker --> Logger
    MiddlemanWorker --> Pocket
    MiddlemanWorker --> Temporal

    %% Shared packages → External deps
    DB --> PostgreSQL
    GraphQL --> PocketNetwork
    Pocket --> PocketNetwork
    Temporal --> TemporalServer
    ProviderWorker --> TemporalServer
    MiddlemanWorker --> TemporalServer
```
