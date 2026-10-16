# Working together on E-Nay

Keep changes small and focused on one feature. Choose a branch before editing; discuss changes to `RecordView` or `RecordRepository` with the teammates using them.

## Areas teammates can work on separately

| Area | Files | Responsibility |
| --- | --- | --- |
| Model | `src/enay/model/` | Record fields, constructors, parsing and serialization |
| View | `src/enay/view/` | Console prompts and display; future Swing screens |
| Controller | `src/enay/controller/` | Registration, navigation, save/reload coordination |
| Data storage | `src/enay/repository/` | Collections, file format, loading, saving and recovery |
| Validation | `src/enay/validation/`, `exception/` | Shared input and business rules |
| Integration | `src/enay/Main.java`, tests, docs | Startup, verification and documentation |

These are work areas, not assignments to named members. Agree on ownership within the group.

## Branch and pull request workflow

Clone the repository once:

```sh
git clone https://github.com/ragingandgamers-ops/e-nay.git
cd e-nay
git switch -c feature/your-feature
```

Edit your files, run `python tests/run_tests.py`, review `git diff`, and commit only the intended source and documentation changes:

```sh
git add src tests docs
git commit -m "Describe the behavior changed"
git push -u origin feature/your-feature
```

Open a pull request to `main`, describe what changed and how it was tested, and ask a teammate to review it. A collaborator can push branches directly. A group member without write access can fork the public repository and open a pull request from the fork. The repository owner manages collaborator invitations.

Before starting the next task:

```sh
git switch main
git pull --ff-only
git switch -c feature/next-feature
```

## Boundaries

- Models and validation do not depend on the console, controller, or repository.
- The view handles user interaction and never accesses data files.
- The controller calls the repository interface, not private file helpers.
- Storage returns diagnostics; the controller sends them to the view.
- Keep local patient data out of commits. Use fictional data in tests.
- Update the architecture and launch documentation when changing packages or entry points.
- Keep the seven menu actions compatible unless a coordinated feature change requires otherwise.

The current application is single-threaded. A Swing migration will need an event-driven controller contract and background I/O with Swing updates on the event dispatch thread; do not claim those are already implemented.
