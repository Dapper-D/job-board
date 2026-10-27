"""The normalized shape every source produces."""

from __future__ import annotations

from dataclasses import dataclass, field


@dataclass
class Posting:
    uid: str                    # "<source>:<native id>", stable across runs
    source: str                 # e.g. "greenhouse"
    source_label: str           # shown on the page, e.g. "Greenhouse (GitLab)"
    verify: str                 # "employer" = company's own board, "listing" = job board
    company: str
    title: str
    location: str
    url: str                    # where to apply
    remote: bool = False
    posted: str = ""            # YYYY-MM-DD, or "" if unknown
    description: str = ""       # plain text
    salary_text: str = ""       # anything the source says about pay
    salary: dict | None = None  # structured pay if the source gives it:
                                # {"min": float, "max": float, "currency": "USD", "interval": "year"|"hour"}
    extra: dict = field(default_factory=dict)

    @property
    def text(self) -> str:
        """Everything searchable about the posting, lower-cased."""
        return " \n".join(
            [self.title, self.location, self.salary_text, self.description]
        ).lower()
