from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session
from typing import List, Optional

from ..database import get_db
from ..models import donation as donation_model
from ..schemas import donation as donation_schema

router = APIRouter(
    prefix="/api/donations",
    tags=["donations"],
    responses={404: {"description": "Not found"}},
)

@router.get("/", response_model=List[donation_schema.Donation])
def read_donations(skip: int = 0, limit: int = 100, db: Session = Depends(get_db)):
    donations = db.query(donation_model.Donation).offset(skip).limit(limit).all()
    return donations

@router.get("/{donation_id}", response_model=donation_schema.Donation)
def read_donation(donation_id: int, db: Session = Depends(get_db)):
    donation = db.query(donation_model.Donation).filter(donation_model.Donation.id == donation_id).first()
    if donation is None:
        raise HTTPException(status_code=404, detail="Donation not found")
    return donation

@router.post("/", response_model=donation_schema.Donation, status_code=status.HTTP_201_CREATED)
def create_donation(donation: donation_schema.DonationCreate, db: Session = Depends(get_db)):
    db_donation = donation_model.Donation(**donation.dict())
    db.add(db_donation)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Donation creation collided with an existing database row. Please retry after the app re-syncs the seed state.",
        ) from None
    db.refresh(db_donation)
    return db_donation

@router.put("/{donation_id}", response_model=donation_schema.Donation)
def update_donation(donation_id: int, donation: donation_schema.DonationCreate, db: Session = Depends(get_db)):
    db_donation = db.query(donation_model.Donation).filter(donation_model.Donation.id == donation_id).first()
    if db_donation is None:
        raise HTTPException(status_code=404, detail="Donation not found")
    for key, value in donation.dict().items():
        setattr(db_donation, key, value)
    db.commit()
    db.refresh(db_donation)
    return db_donation

@router.delete("/{donation_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_donation(donation_id: int, db: Session = Depends(get_db)):
    db_donation = db.query(donation_model.Donation).filter(donation_model.Donation.id == donation_id).first()
    if db_donation is None:
        raise HTTPException(status_code=404, detail="Donation not found")
    db.delete(db_donation)
    db.commit()
    return None