from typing import List, Optional, Dict, Any
from pydantic import BaseModel, Field
from datetime import datetime

class SearchCriteria(BaseModel):
    location: str = Field(default="Washington", description="City or State to search")
    price_min: int = Field(default=350000, description="Minimum price")
    price_max: int = Field(default=500000, description="Maximum price")
    sqft_min: int = Field(default=1200, description="Minimum square footage")
    sqft_max: int = Field(default=2000, description="Maximum square footage")
    beds_min: int = Field(default=2, description="Minimum bedrooms")
    baths_min: float = Field(default=1.0, description="Minimum bathrooms")
    hoa_max: int = Field(default=50, description="Maximum monthly HOA fee")
    lot_size_min: int = Field(default=6500, description="Minimum lot size in sqft")
    garage_min: int = Field(default=2, description="Minimum garage spaces")
    year_built_min: int = Field(default=1980, description="Minimum year built")
    include_zillow: bool = Field(default=True, description="Search Zillow")
    include_realtor: bool = Field(default=True, description="Search Realtor.com")

class PropertyNoteUpdate(BaseModel):
    rating: Optional[int] = Field(default=None, ge=0, le=5, description="Star rating (0-5)")
    user_notes: Optional[str] = Field(default=None, description="Personal notes for this property")
    favorite: Optional[bool] = Field(default=None, description="Whether marked as favorite")

class FavoriteToggle(BaseModel):
    favorite: bool = Field(..., description="Whether marked as favorite")

class PropertyListing(BaseModel):
    id: str
    address: str
    city: str
    state: str = "WA"
    zip: str = ""
    price: int
    beds: int
    baths: float
    sqft: int
    lot_sqft: int
    year_built: int
    hoa: int = 0
    garage: int = 2
    description: str = ""
    url: str
    photos: List[str] = []
    latitude: Optional[float] = None
    longitude: Optional[float] = None
    favorite: bool = False
    rating: int = 0
    user_notes: str = ""

class ScrapeJobStatus(BaseModel):
    is_active: bool = False
    progress: int = 0
    message: str = "Idle"
    logs: List[str] = []
    discovered_count: int = 0
    processed_count: int = 0
    matched_count: int = 0
