from dataclasses import dataclass, field
from datetime import datetime
from typing import Optional

@dataclass
class EventData:
    title: str
    url: str
    event_date: datetime
    category: str          # one of: marketing, sales, analytics, ai, culture, other
    format: str            # online, offline, hybrid
    price_type: str        # free, paid
    source: str
    source_event_id: str
    description: str = ""
    speakers: list[str] = field(default_factory=list)
    price_amount: Optional[int] = None
    cover_image_url: Optional[str] = None
