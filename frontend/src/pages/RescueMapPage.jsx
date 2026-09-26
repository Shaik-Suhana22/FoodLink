import React, { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import {
  MapPin,
  Utensils,
  Home,
  Truck,
  Layers,
  Info,
  Maximize2,
  RefreshCw,
  Navigation,
} from 'lucide-react';
import Card from '../components/common/Card';
import Badge from '../components/common/Badge';
import Button from '../components/common/Button';
import GoogleMapsGroundingSearch from '../components/maps/GoogleMapsGroundingSearch';
import { api } from '../services/api';
import { INDIA_MAP_ENTITIES } from '../data/mockData';

const TELANGANA_BOUNDS = [
  [15.8, 77.0],
  [19.9, 81.7],
];

const TELANGANA_OUTLINE = [
  [17.1944, 77.2800],
  [17.1443, 77.6764],
  [17.2120, 78.0650],
  [17.1767, 78.4482],
  [17.3020, 78.9035],
  [17.5920, 79.3337],
  [18.2578, 79.9567],
  [18.7080, 80.4125],
  [19.2333, 80.9353],
  [19.6617, 80.9728],
  [19.8180, 80.6217],
  [19.8678, 79.9975],
  [19.7721, 79.1550],
  [19.4377, 78.4535],
  [18.9054, 77.9745],
  [18.2065, 77.6206],
  [17.6809, 77.2417],
  [17.1944, 77.2800],
];

const TELANGANA_ROUTE_PAIRS = [
  ['ind-rest-hyd-1', 'ind-sh-hyd-1'],
  ['ind-rest-hyd-2', 'ind-sh-hyd-2'],
  ['ind-rest-hyd-3', 'ind-sh-hyd-3'],
  ['ind-rest-hyd-4', 'ind-sh-hyd-1'],
  ['ind-rest-war-1', 'ind-sh-war-1'],
  ['ind-rest-war-2', 'ind-sh-war-1'],
  ['ind-rest-kh-1', 'ind-sh-kh-1'],
  ['ind-rest-kh-2', 'ind-sh-kh-1'],
  ['ind-rest-nzm-1', 'ind-sh-nzm-1'],
  ['ind-rest-rgd-1', 'ind-sh-rgd-1'],
  ['ind-rest-adil-1', 'ind-sh-adil-1'],
  ['ind-rest-mbn-1', 'ind-sh-mbn-1'],
  ['ind-rest-rch-1', 'ind-sh-rch-1'],
  ['ind-rest-vkm-1', 'ind-sh-rgd-1'],
  ['ind-rest-hyd-1', 'ind-vol-hyd-1'],
  ['ind-rest-hyd-2', 'ind-vol-hyd-2'],
  ['ind-rest-war-1', 'ind-vol-war-1'],
  ['ind-rest-kh-1', 'ind-vol-kh-1'],
  ['ind-rest-nzm-1', 'ind-vol-nzm-1'],
  ['ind-rest-mbn-1', 'ind-vol-mbn-1'],
  ['ind-rest-rch-1', 'ind-vol-rch-1'],
];

const urgencyRank = { SAFE: 0, 'AT RISK': 1, URGENT: 2, CRITICAL: 3 };

const normalizeDonationStatus = (status) => {
  const value = String(status ?? '').trim().toLowerCase().replace(/[_-]+/g, ' ');

  if (!value) return 'available';
  if (['urgent', 'critical', 'pending', 'at risk', 'available'].includes(value)) return 'available';
  if (['matching', 'matched', 'match pending'].includes(value)) return 'matched';
  if (['in transit', 'picked up', 'picked_up', 'pickup', 'en route', 'on route', 'delivery pending'].includes(value)) return 'in transit';
  if (['delivered', 'completed'].includes(value)) return 'completed';
  return value;
};

const classifyDonation = (donation, rescue) => {
  const remainingMinutes = donation.expires_at
    ? (new Date(donation.expires_at).getTime() - Date.now()) / 60000
    : Number.POSITIVE_INFINITY;
  const eta = Number(rescue?.eta_minutes || 0);
  const buffer = remainingMinutes - eta;
  if (remainingMinutes <= 0) return 'CRITICAL';
  if (buffer <= 0) return 'CRITICAL';
  if (remainingMinutes <= 60 || buffer <= 30) return 'URGENT';
  if (remainingMinutes <= 120 || buffer <= 60) return 'AT RISK';
  return 'SAFE';
};

const coordinate = (latitude, longitude) => {
  const lat = Number(latitude);
  const lng = Number(longitude);
  return Number.isFinite(lat) && Number.isFinite(lng) && (lat !== 0 || lng !== 0)
    ? [lat, lng]
    : null;
};

const isValidPosition = (value) => Array.isArray(value) && value.length === 2 && Number.isFinite(value[0]) && Number.isFinite(value[1]);

export default function RescueMapPage() {
  const mapContainerRef = useRef(null);
  const mapInstanceRef = useRef(null);
  const markersLayerRef = useRef(null);
  const routesLayerRef = useRef(null);

  const [activeFilters, setActiveFilters] = useState({
    all: true,
    restaurants: true,
    donations: true,
    recipients: true,
    volunteers: true,
    rescues: true,
    urgent: false,
  });

  const [selectedEntity, setSelectedEntity] = useState(null);
  const [mapEntities, setMapEntities] = useState([]);
  const [activeRescues, setActiveRescues] = useState([]);
  const [selectedRescue, setSelectedRescue] = useState(null);
  const [routeSegments, setRouteSegments] = useState([]);
  const [mapLoading, setMapLoading] = useState(false);
  const [mapError, setMapError] = useState(null);

  useEffect(() => {
    let mounted = true;
    setMapLoading(true);
    setMapError(null);

    api.getMapData()
      .then(({ data }) => {
        if (!mounted) return;

        const rescues = data.rescues || [];
        const donationsByRestaurant = (data.donations || []).reduce((result, donation) => {
          const rescue = rescues.find((item) => item.donation_id === donation.id);
          const status = classifyDonation(donation, rescue);
          const key = String(donation.restaurant_id);
          result[key] = [...(result[key] || []), { ...donation, urgency: status, normalizedStatus: normalizeDonationStatus(donation.status) }];
          return result;
        }, {});

        const restaurantEntities = (data.restaurants || []).map((item) => {
          const donations = donationsByRestaurant[String(item.id)] || [];
          const urgency = donations.length
            ? donations.reduce((highest, donation) => (
                urgencyRank[donation.urgency] > urgencyRank[highest] ? donation.urgency : highest
              ), 'SAFE')
            : 'SAFE';
          return {
            ...item,
            type: 'restaurant',
            name: item.name || 'Restaurant',
            address: item.address || item.name || 'Live donor kitchen',
            position: coordinate(item.latitude, item.longitude),
            donations,
            urgency,
          };
        });

        const donationEntities = (data.donations || []).map((donation) => {
          const restaurant = (data.restaurants || []).find((item) => String(item.id) === String(donation.restaurant_id));
          const position = coordinate(
            restaurant?.latitude ?? donation.latitude ?? donation.location_latitude,
            restaurant?.longitude ?? donation.longitude ?? donation.location_longitude,
          );

          return {
            ...donation,
            id: `donation-${donation.id}`,
            type: 'donation',
            name: donation.food_name || donation.foodName || `Donation #${donation.id}`,
            address: donation.location || restaurant?.address || 'Donation pickup location',
            position,
            donationStatus: donation.status,
            normalizedStatus: normalizeDonationStatus(donation.status),
            urgency: classifyDonation(donation, rescues.find((item) => item.donation_id === donation.id)),
            quantity: donation.quantity,
          };
        }).filter((item) => item.position);

        const mapData = [
          ...restaurantEntities,
          ...donationEntities,
          ...(data.recipients || []).map((item) => ({ ...item, type: 'recipient', position: coordinate(item.latitude, item.longitude), address: item.address || item.name || 'Recipient location' })),
          ...(data.volunteers || []).map((item) => ({ ...item, type: 'volunteer', position: coordinate(item.latitude, item.longitude), address: item.address || item.vehicle || 'Volunteer route status' })),
          ...rescues.map((item) => ({
            ...item,
            id: `rescue-${item.rescue_id}`,
            type: 'rescue',
            name: `Rescue #${item.rescue_id}`,
            position: coordinate(item.volunteer?.latitude, item.volunteer?.longitude)
              || coordinate(item.restaurant?.latitude, item.restaurant?.longitude),
            address: item.restaurant?.name || item.recipient?.name || 'Rescue route',
          })),
        ].filter((item) => item.position);

        setActiveRescues(rescues);
        setMapEntities(mapData);
      })
      .catch(() => {
        if (!mounted) return;
        const fallbackEntities = INDIA_MAP_ENTITIES
          .filter((item) => {
            const lat = Number(item.lat);
            const lng = Number(item.lng);
            return Number.isFinite(lat) && Number.isFinite(lng) && lat >= 15.8 && lat <= 19.9 && lng >= 77.0 && lng <= 81.7;
          })
          .map((item) => ({
            ...item,
            position: isValidPosition([item.lat, item.lng]) ? [item.lat, item.lng] : null,
          }))
          .filter((item) => item.position);

        setMapEntities(fallbackEntities);
        setMapError('Live backend unavailable — demo map data is shown instead.');
      })
      .finally(() => {
        if (mounted) setMapLoading(false);
      });

    return () => { mounted = false; };
  }, []);

  // Initialize map view for India with Telangana-focused framing in Leaflet.
  useEffect(() => {
    if (!mapContainerRef.current) return;
    if (mapInstanceRef.current) return;

    const map = L.map(mapContainerRef.current, {
      center: [17.9, 79.5],
      zoom: 7,
      zoomControl: true,
      minZoom: 6,
      maxZoom: 18,
    });

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      maxZoom: 19,
    }).addTo(map);

    L.polygon(TELANGANA_OUTLINE, {
      color: '#2f6fdc',
      weight: 2,
      opacity: 0.9,
      fillColor: '#60a5fa',
      fillOpacity: 0.08,
      dashArray: '10, 8',
    }).addTo(map);

    L.control.scale({ position: 'bottomleft', imperial: false }).addTo(map);

    markersLayerRef.current = L.layerGroup().addTo(map);
    routesLayerRef.current = L.layerGroup().addTo(map);

    mapInstanceRef.current = map;

    const bounds = L.latLngBounds(TELANGANA_BOUNDS);
    map.fitBounds(bounds, { padding: [30, 30] });

    const invalidateTimer = setTimeout(() => {
      map.invalidateSize();
    }, 250);

    const handleResize = () => {
      map.invalidateSize();
    };
    window.addEventListener('resize', handleResize);

    return () => {
      clearTimeout(invalidateTimer);
      window.removeEventListener('resize', handleResize);
      map.remove();
      mapInstanceRef.current = null;
    };
  }, []);

  const fetchRoadRoute = async (from, to) => {
    if (!from || !to) return null;

    try {
      const response = await fetch(
        `https://router.project-osrm.org/route/v1/driving/${from[1]},${from[0]};${to[1]},${to[0]}?overview=full&geometries=geojson&steps=false`
      );

      if (!response.ok) return null;

      const data = await response.json();
      const coordinates = data?.routes?.[0]?.geometry?.coordinates;
      if (!Array.isArray(coordinates) || coordinates.length === 0) return null;

      return coordinates.map(([lng, lat]) => [lat, lng]);
    } catch (error) {
      console.warn('OSRM route lookup failed:', error);
      return null;
    }
  };

  useEffect(() => {
    let cancelled = false;

    const buildRouteSegments = async () => {
      const entityMap = new Map(mapEntities.map((entity) => [entity.id, entity]));
      const segments = [];

      for (const [fromId, toId] of TELANGANA_ROUTE_PAIRS) {
        const from = entityMap.get(fromId);
        const to = entityMap.get(toId);

        if (!from?.position || !to?.position) continue;

        const roadRoute = await fetchRoadRoute(from.position, to.position);
        const isVolunteerLink = to.type === 'volunteer';

        segments.push({
          path: roadRoute || [from.position, to.position],
          color: isVolunteerLink ? '#3b82f6' : '#16a34a',
          weight: isVolunteerLink ? 2 : 3,
          dashArray: isVolunteerLink ? '5, 8' : '8, 8',
          opacity: isVolunteerLink ? 0.8 : 0.9,
        });
      }

      if (!cancelled) {
        setRouteSegments(segments);
      }
    };

    buildRouteSegments();

    return () => {
      cancelled = true;
    };
  }, [mapEntities]);

  // Update Markers & Polylines when filters change
  useEffect(() => {
    if (!mapInstanceRef.current || !markersLayerRef.current || !routesLayerRef.current) return;

    markersLayerRef.current.clearLayers();
    routesLayerRef.current.clearLayers();

    // Custom Icon Factory using HTML/Tailwind for crisp vector markers
    const createCustomIcon = (type) => {
      let bg = 'bg-emerald-600';
      let symbol = 'F';

      if (type === 'restaurant') {
        bg = 'bg-amber-500';
        symbol = '🍽';
      } else if (type === 'donation') {
        bg = 'bg-rose-500';
        symbol = '📦';
      } else if (type === 'recipient') {
        bg = 'bg-emerald-600';
        symbol = '🏠';
      } else if (type === 'volunteer') {
        bg = 'bg-blue-600';
        symbol = '🚚';
      } else if (type === 'rescue') {
        bg = 'bg-red-600';
        symbol = '↗';
      }

      return L.divIcon({
        className: 'custom-leaflet-marker',
        html: `
          <div class="relative flex items-center justify-center">
            <div class="w-8 h-8 rounded-full ${bg} text-white shadow-md border-2 border-white flex items-center justify-center text-xs font-bold transform -translate-x-1/2 -translate-y-1/2 hover:scale-110 transition-transform">
              ${symbol}
            </div>
          </div>
        `,
        iconSize: [32, 32],
        iconAnchor: [16, 16],
      });
    };

    const visibleEntities = mapEntities.filter((entity) => {
      if (!entity.position || !isValidPosition(entity.position)) return false;
      if (activeFilters.all) return true;
      if (entity.type === 'restaurant' && !activeFilters.restaurants) return false;
      if (entity.type === 'donation' && !activeFilters.donations) return false;
      if (entity.type === 'recipient' && !activeFilters.recipients) return false;
      if (entity.type === 'volunteer' && !activeFilters.volunteers) return false;
      if (entity.type === 'rescue' && !activeFilters.rescues) return false;
      if (activeFilters.urgent && entity.type === 'restaurant' && entity.urgency === 'SAFE') return false;
      return true;
    });

    // Render Markers
    visibleEntities.forEach((entity) => {
      const marker = L.marker(entity.position, {
        icon: createCustomIcon(entity.type),
      });

      marker.on('click', () => {
        setSelectedEntity(entity);
        if (entity.type === 'rescue') {
          setSelectedRescue(entity);
        }
      });

      const popupContent = `
        <div style="font-family: inherit; font-size: 12px; line-height: 1.4; padding: 4px;">
          <div style="font-weight: 700; color: #0f172a; margin-bottom: 2px;">${entity.name}</div>
          <div style="color: #64748b; font-size: 11px;">${entity.address || entity.vehicle || ''}</div>
          <div style="color: ${entity.type === 'donation' ? '#e11d48' : '#16a34a'}; font-weight: 600; margin-top: 4px;">
            ${entity.urgency || entity.status || entity.capacity || entity.donationStatus || ''}
          </div>
          ${entity.quantity ? `<div style="color: #475569; margin-top: 4px;">${entity.quantity}</div>` : ''}
        </div>
      `;
      marker.bindPopup(popupContent);
      markersLayerRef.current.addLayer(marker);
    });

    // Render visible launch routes between donor kitchens and nearby shelters/volunteers.
    if (activeFilters.rescues || activeFilters.all) {
      routeSegments.forEach((segment) => {
        const polyline = L.polyline(segment.path, {
          color: segment.color,
          weight: segment.weight,
          dashArray: segment.dashArray,
          opacity: segment.opacity,
        });
        routesLayerRef.current.addLayer(polyline);
      });
    }
  }, [activeFilters, mapEntities, selectedRescue, routeSegments]);

  const toggleFilter = (filterKey) => {
    setActiveFilters((prev) => {
      if (filterKey === 'all') {
        return { ...prev, all: true, restaurants: true, donations: true, recipients: true, volunteers: true, rescues: true, urgent: false };
      }
      if (prev.all) {
        return { all: false, restaurants: false, donations: false, recipients: false, volunteers: false, rescues: false, urgent: false, [filterKey]: true };
      }
      return { ...prev, all: false, [filterKey]: !prev[filterKey] };
    });
  };

  const centerOnEntity = (entity) => {
    setSelectedEntity(entity);
    if (entity.type === 'rescue') setSelectedRescue(entity);
    if (mapInstanceRef.current) {
      mapInstanceRef.current.setView(entity.position, 15, {
        animate: true,
      });
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">
            Telangana Food Rescue Network
          </h1>
          <p className="text-xs sm:text-sm text-slate-500 mt-1">
            Live telemetry for Telangana logistics corridors, donor hubs, shelter demand, and volunteer dispatch routes across the state.
          </p>
        </div>

        {/* Layer Filter Toggles */}
        <div className="flex flex-wrap items-center gap-2 bg-white p-1.5 rounded-lg border border-slate-200 text-xs">
          <button
            type="button"
            onClick={() => toggleFilter('all')}
            className={`px-2.5 py-1 rounded font-medium transition-colors ${
              activeFilters.all
                ? 'bg-slate-900 text-white font-semibold'
                : 'text-slate-500 hover:text-slate-800'
            }`}
          >
            All
          </button>
          <button
            type="button"
            onClick={() => toggleFilter('restaurants')}
            className={`px-2.5 py-1 rounded font-medium transition-colors ${
              activeFilters.restaurants && !activeFilters.all
                ? 'bg-amber-100 text-amber-900 font-semibold'
                : 'text-slate-500 hover:text-slate-800'
            }`}
          >
            Restaurants
          </button>
          <button
            type="button"
            onClick={() => toggleFilter('donations')}
            className={`px-2.5 py-1 rounded font-medium transition-colors ${
              activeFilters.donations && !activeFilters.all
                ? 'bg-rose-100 text-rose-900 font-semibold'
                : 'text-slate-500 hover:text-slate-800'
            }`}
          >
            Donation Pins
          </button>
          <button
            type="button"
            onClick={() => toggleFilter('recipients')}
            className={`px-2.5 py-1 rounded font-medium transition-colors ${
              activeFilters.recipients && !activeFilters.all
                ? 'bg-emerald-100 text-emerald-900 font-semibold'
                : 'text-slate-500 hover:text-slate-800'
            }`}
          >
            Recipients
          </button>
          <button
            type="button"
            onClick={() => toggleFilter('volunteers')}
            className={`px-2.5 py-1 rounded font-medium transition-colors ${
              activeFilters.volunteers && !activeFilters.all
                ? 'bg-blue-100 text-blue-900 font-semibold'
                : 'text-slate-500 hover:text-slate-800'
            }`}
          >
            Volunteers
          </button>
          <button
            type="button"
            onClick={() => toggleFilter('rescues')}
            className={`px-2.5 py-1 rounded font-medium transition-colors ${
              activeFilters.rescues && !activeFilters.all
                ? 'bg-red-100 text-red-900 font-semibold'
                : 'text-slate-500 hover:text-slate-800'
            }`}
          >
            Active Rescues
          </button>
          <button
            type="button"
            onClick={() => toggleFilter('urgent')}
            className={`px-2.5 py-1 rounded font-medium transition-colors ${
              activeFilters.urgent && !activeFilters.all
                ? 'bg-amber-100 text-amber-900 font-semibold'
                : 'text-slate-500 hover:text-slate-800'
            }`}
          >
            Urgent Donations
          </button>
        </div>
      </div>
      {mapError && <div className="p-3 rounded-lg border border-red-200 bg-red-50 text-sm text-red-700">{mapError}</div>}

      {/* Map + Sidebar Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        {/* Main Map Viewport (3 Cols) */}
        <div className="lg:col-span-3">
          <div className="relative h-[650px] w-full rounded-xl overflow-hidden border border-slate-200/90 shadow-xs bg-slate-100">
            <div ref={mapContainerRef} className="w-full h-full" />

            {/* Over-map Legend overlay */}
            <div className="absolute bottom-4 left-4 z-20 bg-white/95 backdrop-blur-xs p-3 rounded-lg border border-slate-200 shadow-md text-xs space-y-1.5">
              <div className="font-semibold text-slate-800 text-[11px] uppercase tracking-wider">
                Active Corridor Legend
              </div>
              <div className="flex items-center gap-2 text-slate-600">
                <span className="w-2.5 h-2.5 rounded-full bg-amber-500" />
                <span>Donor Kitchen (Surplus Ready)</span>
              </div>
              <div className="flex items-center gap-2 text-slate-600">
                <span className="w-2.5 h-2.5 rounded-full bg-emerald-600" />
                <span>Verified Shelter (Needs Meals)</span>
              </div>
              <div className="flex items-center gap-2 text-slate-600">
                <span className="w-2.5 h-2.5 rounded-full bg-blue-600" />
                <span>Courier Van In Transit</span>
              </div>
              <div className="flex items-center gap-2 text-slate-600">
                <span className="w-4 h-0.5 border-t-2 border-dashed border-emerald-600" />
                <span>Optimized Dispatch Corridor</span>
              </div>
            </div>
          </div>
        </div>

        {/* Sidebar Nodes Explorer (1 Col) */}
        <div className="space-y-4">
          <Card
            title="Active Network Nodes"
            subtitle="Click node to center view"
            bodyClassName="p-3 max-h-[590px] overflow-y-auto space-y-2.5"
          >
            {mapLoading && <div className="p-3 text-xs text-slate-500">Loading live map data...</div>}
            {!mapLoading && mapEntities.length === 0 && !mapError && <div className="p-3 text-xs text-slate-500">No live map entities found.</div>}
            {mapEntities.map((entity) => (
              <div
                key={entity.id}
                onClick={() => centerOnEntity(entity)}
                className={`p-3 rounded-lg border cursor-pointer transition-all ${
                  selectedEntity?.id === entity.id
                    ? 'border-emerald-600 bg-emerald-50/50 shadow-xs'
                    : 'border-slate-200 bg-white hover:bg-slate-50'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-slate-900 truncate">
                    {entity.name}
                  </span>
                  <span className="text-[10px] font-mono uppercase font-semibold text-slate-500">
                    {entity.type}
                  </span>
                </div>
                <p className="text-[11px] text-slate-500 mt-0.5 truncate">
                  {entity.address || entity.vehicle}
                </p>
                <p className="text-xs font-medium text-emerald-700 mt-1">
                  {entity.urgency || entity.status || entity.capacity || 'Live backend entity'}
                </p>
              </div>
            ))}
          </Card>
          {selectedRescue && (
            <Card title={`Rescue #${selectedRescue.rescue_id}`} subtitle="Selected active rescue" bodyClassName="p-3 space-y-2 text-xs">
              <div className="font-semibold text-slate-900">{selectedRescue.status}</div>
              <div className="text-slate-600">{selectedRescue.restaurant?.name || 'Restaurant'} <span className="mx-1">↓</span> {selectedRescue.volunteer?.name || 'Volunteer'} <span className="mx-1">↓</span> {selectedRescue.recipient?.name || 'Recipient'}</div>
              <div className="grid grid-cols-2 gap-2 font-mono text-[11px] text-slate-600">
                <span>Distance: {selectedRescue.distance_km ?? 'n/a'} km</span>
                <span>ETA: {selectedRescue.eta_minutes ?? 'n/a'} min</span>
                <span>Expires: {selectedRescue.expires_at ? new Date(selectedRescue.expires_at).toLocaleString() : 'n/a'}</span>
                <span>Status: {selectedRescue.status}</span>
              </div>
            </Card>
          )}
        </div>
      </div>

      {/* Google Maps Live Grounding Search Panel */}
      <div className="pt-2">
        <GoogleMapsGroundingSearch />
      </div>
    </div>
  );
}
