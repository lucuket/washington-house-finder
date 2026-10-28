"""Pydantic request/response models for the Washington Home Search API."""
from typing import Any, Dict, List, Optional

from pydantic import BaseModel, Field


class SearchCriteria(BaseModel):
    location: str = Field(default="Washington", min_length=1, max_length=80,
                          description="City or state to search")
    price_min: int = Field(default=350000, ge=0, description="Minimum price")
    price_max: int = Field(default=500000, ge=0, description="Maximum price")
    sqft_min: int = Field(default=1200, ge=0, description="Minimum square footage")
    sqft_max: int = Field(default=2000, ge=0, description="Maximum square footage")
    beds_min: int = Field(default=2, ge=0, le=20, description="Minimum bedrooms")
    baths_min: float = Field(default=1.0, ge=0, le=20, description="Minimum bathrooms")
    hoa_max: int = Field(default=50, ge=0, description="Maximum monthly HOA fee")
    lot_size_min: int = Field(default=6500, ge=0, description="Minimum lot size in sqft")
    garage_min: int = Field(default=2, ge=0, le=10, description="Minimum garage spaces")
    year_built_min: int = Field(default=1980, ge=0, le=2100, description="Minimum year built")


class PropertyNoteUpdate(BaseModel):
    rating: Optional[int] = Field(default=None, ge=0, le=5, description="Star rating (0-5)")
    user_notes: Optional[str] = Field(default=None, max_length=20000,
                                      description="Personal notes for this property")
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
    garage: int = 0
    description: str = ""
    url: str
    photos: List[str] = Field(default_factory=list)
    latitude: Optional[float] = None
    longitude: Optional[float] = None
    favorite: bool = False
    rating: int = 0
    user_notes: str = ""
    broadband: Optional[Dict[str, Any]] = None
    unknown_fields: Optional[List[str]] = None

    model_config = {"extra": "allow"}


class ScrapeJobStatus(BaseModel):
    is_active: bool = False
    progress: int = 0
    message: str = "Idle"
    logs: List[str] = Field(default_factory=list)
    matched_count: int = 0
