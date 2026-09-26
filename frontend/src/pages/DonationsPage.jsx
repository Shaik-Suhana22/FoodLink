import React, { useState, useMemo, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Plus,
  Search,
  Filter,
  Eye,
  Sparkles,
  UtensilsCrossed,
  Clock,
  ShieldCheck,
  AlertCircle,
  Thermometer,
} from 'lucide-react';
import Card from '../components/common/Card';
import Table from '../components/common/Table';
import Badge from '../components/common/Badge';
import Button from '../components/common/Button';
import Modal from '../components/common/Modal';
import { RECENT_DONATIONS } from '../data/mockData';
import { useToast } from '../components/common/Toast';
import { api } from '../services/api';

const DONATION_STATUS_OPTIONS = ['All', 'Available', 'Matched', 'In Transit', 'Completed'];

const normalizeDonationStatus = (status) => {
  const value = String(status ?? '').trim().toLowerCase().replace(/[_-]+/g, ' ');

  if (!value) return 'available';
  if (['urgent', 'critical', 'pending', 'at risk', 'available'].includes(value)) return 'available';
  if (['matching', 'matched', 'match pending'].includes(value)) return 'matched';
  if (['in transit', 'picked up', 'picked_up', 'pickup', 'en route', 'on route', 'delivery pending'].includes(value)) return 'in transit';
  if (['delivered', 'completed'].includes(value)) return 'completed';
  return value;
};

const formatDonationStatus = (status) => {
  const normalized = normalizeDonationStatus(status);
  if (normalized === 'matched') return 'Matched';
  if (normalized === 'in transit') return 'In Transit';
  if (normalized === 'completed') return 'Completed';
  return 'Available';
};

export default function DonationsPage() {
  const navigate = useNavigate();
  const { addToast } = useToast();
  const [donations, setDonations] = useState([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('All');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selectedDonation, setSelectedDonation] = useState(null);
  const [isDetailModalOpen, setIsDetailModalOpen] = useState(false);

  const loadDonations = async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await api.getDonations();
      setDonations(response.data || []);
    } catch (requestError) {
      setError('Backend unavailable');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadDonations(); }, []);

  const filteredDonations = useMemo(() => {
    return donations.map((item) => {
      const normalizedStatus = normalizeDonationStatus(item.status);
      return {
        ...item,
        restaurant: item.restaurant?.name || item.restaurant_name || `Restaurant #${item.restaurant_id}`,
        foodName: item.foodName || item.food_name,
        category: item.category || item.food_category,
        dietType: item.dietType || item.diet_type || 'Not specified',
        preparedTime: item.preparedTime || item.prepared_at,
        expiryTime: item.expiryTime || item.expires_at,
        expiryHours: item.expiryHours || Math.max(0, (new Date(item.expires_at) - Date.now()) / 3600000),
        storageCondition: item.storageCondition || item.storage_condition || 'Not specified',
        matchedShelter: item.matchedShelter || null,
        normalizedStatus,
        displayStatus: formatDonationStatus(normalizedStatus),
      };
    }).filter((item) => {
      const matchesSearch =
        item.restaurant.toLowerCase().includes(searchTerm.toLowerCase()) ||
        item.foodName.toLowerCase().includes(searchTerm.toLowerCase()) ||
        item.category.toLowerCase().includes(searchTerm.toLowerCase());

      const matchesStatus =
        statusFilter === 'All' || item.normalizedStatus === normalizeDonationStatus(statusFilter);

      return matchesSearch && matchesStatus;
    });
  }, [searchTerm, statusFilter, donations]);

  const handleOpenDetail = (donation) => {
    setSelectedDonation(donation);
    setIsDetailModalOpen(true);
  };

  const tableColumns = [
    {
      key: 'restaurant',
      header: 'Donor Restaurant',
      render: (_, row) => (
        <div>
          <div className="font-semibold text-slate-900">{row.restaurant}</div>
          <div className="text-xs text-slate-500">{row.location}</div>
        </div>
      ),
    },
    {
      key: 'foodName',
      header: 'Food Item & Classification',
      render: (_, row) => (
        <div>
          <div className="font-medium text-slate-800">{row.foodName}</div>
          <div className="text-xs text-slate-500">
            {row.category} · {row.dietType}
          </div>
        </div>
      ),
    },
    {
      key: 'quantity',
      header: 'Volume / Quantity',
      className: 'font-mono text-xs',
    },
    {
      key: 'expiryTime',
      header: 'Expiry SLA',
      render: (val, row) => (
        <div>
          <span
            className={`font-mono text-xs font-semibold ${
              row.expiryHours <= 2 ? 'text-red-600' : 'text-slate-700'
            }`}
          >
            {val}
          </span>
          <div className="text-[11px] text-slate-400">Prep {row.preparedTime}</div>
        </div>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      render: (val, row) => <Badge status={row.displayStatus || formatDonationStatus(val)}>{row.displayStatus || formatDonationStatus(val)}</Badge>,
    },
    {
      key: 'matchedShelter',
      header: 'Assigned Match',
      render: (val) => (
        <span className="text-xs text-slate-700">
          {val || <span className="text-slate-400 italic">Unassigned</span>}
        </span>
      ),
    },
    {
      key: 'actions',
      header: 'Actions',
      align: 'right',
      render: (_, row) => (
        <div className="flex items-center justify-end gap-2">
          <Button
            onClick={() => handleOpenDetail(row)}
            variant="ghost"
            size="sm"
            className="p-1.5 text-slate-600 hover:text-slate-900"
            title="Inspect Details"
          >
            <Eye className="w-4 h-4" />
          </Button>

          {['available', 'matched'].includes(normalizeDonationStatus(row.status)) ? (
            <Button
              onClick={() => navigate('/matches')}
              variant="primary"
              size="sm"
              icon={Sparkles}
              className="text-xs py-1 px-2.5"
            >
              Match
            </Button>
          ) : (
            <Button
              onClick={() => navigate('/map')}
              variant="secondary"
              size="sm"
              className="text-xs py-1 px-2.5"
            >
              Track
            </Button>
          )}
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      {/* Top Banner */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">
            Surplus Food Inventory
          </h1>
          <p className="text-xs sm:text-sm text-slate-500 mt-1">
            Real-time surplus listings reported by regional commercial kitchens and hospitality partners.
          </p>
        </div>

        <Button
          onClick={() => navigate('/donations/new')}
          variant="primary"
          icon={Plus}
          size="md"
        >
          Log Surplus Food
        </Button>
      </div>

      {/* Filter and Search Bar */}
      <Card bodyClassName="p-4">
        <div className="flex flex-col md:flex-row items-center justify-between gap-4">
          {/* Search Box */}
          <div className="relative w-full md:w-80">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-3" />
            <input
              type="text"
              placeholder="Search donor, dish, or category..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-9 pr-3 py-1.5 text-sm bg-white border border-slate-200 rounded-lg focus:outline-hidden focus:border-emerald-600 focus:ring-1 focus:ring-emerald-600"
            />
          </div>

          {/* Status Filter Tabs (Buttons with click handlers) */}
          <div className="flex items-center gap-1 overflow-x-auto w-full md:w-auto p-1 bg-slate-100 rounded-lg">
            {DONATION_STATUS_OPTIONS.map((status) => (
              <button
                key={status}
                type="button"
                onClick={() => setStatusFilter(status)}
                className={`px-3 py-1 text-xs font-medium rounded-md whitespace-nowrap transition-colors ${
                  statusFilter === status
                    ? 'bg-white text-slate-900 shadow-xs font-semibold'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {status}
              </button>
            ))}
          </div>
        </div>
      </Card>

      {error && (
        <Card bodyClassName="p-4">
          <div className="flex items-center justify-between gap-4 text-sm text-red-700">
            <span>{error}</span>
            <Button onClick={loadDonations} variant="secondary" size="sm">Retry</Button>
          </div>
        </Card>
      )}

      {loading && <Card bodyClassName="p-8 text-center text-sm text-slate-500">Loading donations...</Card>}

      {/* Main Donations Table */}
      {!loading && (
      <Card bodyClassName="p-0">
        <Table
          columns={tableColumns}
          data={filteredDonations}
          keyField="id"
          emptyMessage="No food donations found matching your search criteria."
        />
      </Card>
      )}

      {/* Donation Detail Modal */}
      <Modal
        isOpen={isDetailModalOpen}
        onClose={() => setIsDetailModalOpen(false)}
        title={selectedDonation?.foodName || 'Donation Specification'}
        subtitle={`Manifest ID: ${selectedDonation?.id} · Donor: ${selectedDonation?.restaurant}`}
        actions={
          <>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setIsDetailModalOpen(false)}
            >
              Close
            </Button>
            <Button
              variant="primary"
              size="sm"
              icon={Sparkles}
              onClick={() => {
                setIsDetailModalOpen(false);
                navigate('/matches');
              }}
            >
              Open AI Matching Engine
            </Button>
          </>
        }
      >
        {selectedDonation && (
          <div className="space-y-4 text-xs">
            <div className="grid grid-cols-2 gap-4 p-3 bg-slate-50 rounded-lg border border-slate-100">
              <div>
                <p className="text-slate-500 font-medium">Storage Requirement</p>
                <p className="text-sm font-semibold text-slate-900 mt-0.5 flex items-center gap-1.5">
                  <Thermometer className="w-4 h-4 text-emerald-600" />
                  {selectedDonation.storageCondition}
                </p>
              </div>
              <div>
                <p className="text-slate-500 font-medium">Biological Safe Window</p>
                <p className="text-sm font-semibold text-red-600 font-mono mt-0.5">
                  {selectedDonation.expiryTime}
                </p>
              </div>
            </div>

            <div className="space-y-2">
              <h4 className="font-semibold text-slate-800">Dietary & Allergen Verification</h4>
              <p className="text-slate-600">
                Classification: <span className="font-medium text-slate-900">{selectedDonation.dietType}</span>
              </p>
              <p className="text-slate-600">
                Portions: <span className="font-medium text-slate-900">{selectedDonation.quantity}</span>
              </p>
              <p className="text-slate-600">
                Pickup Location: <span className="font-medium text-slate-900">{selectedDonation.location}</span>
              </p>
            </div>

            <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-lg flex items-start gap-2.5">
              <ShieldCheck className="w-4 h-4 text-emerald-700 shrink-0 mt-0.5" />
              <div className="text-[11px] text-emerald-800 leading-relaxed">
                Food Agent verified HACCP thermal compliance log. Temperature sensors confirm proper containment prior to driver dispatch.
              </div>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
