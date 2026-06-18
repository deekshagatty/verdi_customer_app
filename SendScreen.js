import React, { useEffect, useMemo, useState } from 'react';
import {
  ScrollView,
  View,
  Text,
  Pressable,
  StyleSheet,
  TextInput,
  Modal,
  ActivityIndicator,
  Alert,
  Platform,
} from 'react-native';
import { WebView } from 'react-native-webview';
import { Feather } from '@expo/vector-icons';
import { COLORS, shadow } from '../components/theme';
import { initMyFatoorah, getMyFatoorahMethods, payWithMyFatoorah } from '../myfatoorah';

const BASE_URL = 'https://tryverdi.com/api/customer';

const times = ['2:30 PM', '3:00 PM', '3:30 PM', '4:00 PM', '4:30 PM', '5:00 PM'];

let ORDER_SEQUENCE = 1001;
function makeAppOrderId() {
  const id = `APP-ORDER-${ORDER_SEQUENCE}`;
  ORDER_SEQUENCE += 1;
  return id;
}


function getPaymentMethodName(method) {
  return String(
    method?.PaymentMethodEn ||
      method?.paymentMethodEn ||
      method?.PaymentMethodName ||
      method?.paymentMethodName ||
      ''
  ).toLowerCase();
}

function getPaymentType(method) {
  const name = getPaymentMethodName(method);

  if (name.includes('knet') || name.includes('k-net')) return 'knet';
  if (name.includes('apple')) return 'apple_pay';
  if (name.includes('visa') || name.includes('master')) return 'visa_master';

  return 'myfatoorah';
}

function getBranchId(branch) {
  return branch?.id || branch?.branch_id || branch?.branchId || null;
}

function getAddressValue(obj, keys) {
  for (const key of keys) {
    const value = obj?.[key];
    if (value !== undefined && value !== null && String(value).trim()) {
      return String(value).trim();
    }
  }
  return '';
}

function parseKuwaitAddressParts(candidate) {
  const attrs = candidate?.attributes || {};
  const text = `${candidate?.address || ''} ${Object.values(attrs).join(' ')}`;

  const area = getAddressValue(attrs, [
    'Neighborhood',
    'District',
    'City',
    'PlaceName',
    'Region',
    'Subregion',
  ]);

  const street = getAddressValue(attrs, [
    'StAddr',
    'Address',
    'StreetName',
    'Street',
    'ShortLabel',
  ]);

  const blockMatch = text.match(/(?:block|blk|قطعة)\s*[:#-]?\s*([0-9A-Za-z]+)/i);
  const buildingMatch = text.match(/(?:building|bldg|house|plot|parcel|مبنى)\s*[:#-]?\s*([0-9A-Za-z\/-]+)/i);

  return {
    area,
    block: blockMatch?.[1] || getAddressValue(attrs, ['Block', 'Blk']),
    street,
    building: buildingMatch?.[1] || getAddressValue(attrs, ['AddNum', 'Building', 'Bldg', 'House']),
  };
}

function ArcGisAddressMap({ visible, onClose, onSelect, title = 'Select address' }) {
  const html = useMemo(() => {
    return `<!doctype html>
<html>
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="initial-scale=1,maximum-scale=1,user-scalable=no"/>
<link rel="stylesheet" href="https://js.arcgis.com/4.30/esri/themes/light/main.css"/>
<script src="https://js.arcgis.com/4.30/"></script>
<style>
  html,body,#view{height:100%;width:100%;margin:0;padding:0;overflow:hidden}
  .bubble{position:absolute;left:16px;right:16px;bottom:90px;background:#fff;border:1px solid #E5E7EB;border-radius:16px;padding:12px 14px;box-shadow:0 10px 24px rgba(0,0,0,.18);z-index:9999}
  .title{font-weight:800;color:#111827;margin:0 0 8px;font-family:Arial;font-size:14px}
  .use{color:#0b8f2a;font-weight:800;text-decoration:none;font-family:Arial;font-size:15px}
  .pin{position:absolute;width:22px;height:22px;margin-left:-11px;margin-top:-22px;border-radius:22px;background:#0b8f2a;border:3px solid #fff;box-shadow:0 6px 14px rgba(0,0,0,.3);z-index:9998}
  .loading{position:absolute;top:50%;left:20px;right:20px;text-align:center;font-family:Arial;font-weight:700;color:#111827}
</style>
</head>
<body>
<div id="view"></div>
<div class="loading" id="loading">Loading map...</div>

<script>
let _view=null,_pin=null,_bubble=null;

function sendError(message){
  if(window.ReactNativeWebView){
    window.ReactNativeWebView.postMessage(JSON.stringify({type:'error',message:String(message || 'Map error')}));
  }
}

function clearOverlays(){
  if(_pin && _pin.parentNode) _pin.parentNode.removeChild(_pin);
  if(_bubble && _bubble.parentNode) _bubble.parentNode.removeChild(_bubble);
  _pin=null; _bubble=null;
}

function reverseAddress(mapPoint){
  const url='https://geocode.arcgis.com/arcgis/rest/services/World/GeocodeServer/reverseGeocode?f=pjson&langCode=EN&location='
    + mapPoint.longitude + ',' + mapPoint.latitude;

  return fetch(url)
    .then(r=>r.json())
    .then(j=>{
      if(j && j.address && j.address.Match_addr) return j.address.Match_addr;
      return mapPoint.latitude.toFixed(5)+', '+mapPoint.longitude.toFixed(5);
    })
    .catch(()=>mapPoint.latitude.toFixed(5)+', '+mapPoint.longitude.toFixed(5));
}

function showUsePoint(mapPoint){
  clearOverlays();

  const scr=_view.toScreen(mapPoint);
  _pin=document.createElement('div');
  _pin.className='pin';
  _pin.style.left=scr.x+'px';
  _pin.style.top=scr.y+'px';
  _view.container.appendChild(_pin);

  reverseAddress(mapPoint).then(addr=>{
    _bubble=document.createElement('div');
    _bubble.className='bubble';
    _bubble.innerHTML='<div class="title">'+addr+'</div><a href="#" class="use" id="usePoint">Use this address</a>';
    _view.container.appendChild(_bubble);

    document.getElementById('usePoint').onclick=function(ev){
      ev.preventDefault();
      window.ReactNativeWebView.postMessage(JSON.stringify({
        type:'usePoint',
        payload:{address:addr,lat:mapPoint.latitude,lng:mapPoint.longitude}
      }));
    };
  });
}

try{
  require(["esri/Map","esri/views/MapView","esri/layers/VectorTileLayer","esri/Basemap"],
  function(Map,MapView,VectorTileLayer,Basemap){
    const vtl=new VectorTileLayer({
      url:"https://kuwaitportal.paci.gov.kw/arcgisportal/rest/services/Hosted/PACIKFBasemap/VectorTileServer"
    });

    const basemap=new Basemap({baseLayers:[vtl]});
    const map=new Map({basemap});

    _view=new MapView({
      container:"view",
      map:map,
      center:[47.9925,29.3775],
      zoom:14
    });

    _view.ui.components=[];

    _view.when(function(){
      const loading=document.getElementById('loading');
      if(loading) loading.style.display='none';
    }).catch(function(err){
      sendError(err && err.message ? err.message : err);
    });

    _view.on('click',function(e){
      if(e.mapPoint) showUsePoint(e.mapPoint);
    });
  });
}catch(e){
  sendError(e && e.message ? e.message : e);
}
</script>
</body>
</html>`;
  }, []);

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="fullScreen" onRequestClose={onClose}>
      <View style={s.mapPage}>
        <View style={s.mapHeader}>
          <Text style={s.mapTitle}>{title}</Text>
          <Pressable onPress={onClose} style={s.mapClose}>
            <Feather name="x" size={24} color="#111" />
          </Pressable>
        </View>

        <WebView
          originWhitelist={['*']}
          source={{ html }}
          javaScriptEnabled
          domStorageEnabled
          mixedContentMode="always"
          allowFileAccess
          allowUniversalAccessFromFileURLs
          setSupportMultipleWindows={false}
          androidLayerType="hardware"
          style={s.mapWebView}
          onError={(e) => {
            console.log('MAP WEBVIEW ERROR:', e.nativeEvent);
            Alert.alert('Map error', e?.nativeEvent?.description || 'Map failed to load');
          }}
          onMessage={(e) => {
            try {
              const msg = JSON.parse(e.nativeEvent.data);

              if (msg.type === 'error') {
                Alert.alert('Map error', msg.message);
                return;
              }

              if (msg.type === 'usePoint') onSelect(msg.payload);
            } catch (err) {
              console.log('MAP MESSAGE ERROR:', err);
            }
          }}
        />
      </View>
    </Modal>
  );
}

export default function SendScreen({ go, later, language, token }) {
  const arabic = language === 'ar';

  const [hasAddress, setHasAddress] = useState(true);
  const [payer, setPayer] = useState('me');
  const [selectedTime, setSelectedTime] = useState('');

  const [receiverName, setReceiverName] = useState('');
  const [receiverPhone, setReceiverPhone] = useState('');
  const [dropoffAddress, setDropoffAddress] = useState('');
  const [dropoffLat, setDropoffLat] = useState('');
  const [dropoffLng, setDropoffLng] = useState('');
  const [dropoffModal, setDropoffModal] = useState(false);
  const [dropoffSelectOpen, setDropoffSelectOpen] = useState(false);
  const [dropoffSearchText, setDropoffSearchText] = useState('');
  const [dropoffSearching, setDropoffSearching] = useState(false);
  const [dropoffSuggestions, setDropoffSuggestions] = useState([]);

  const [dropoffForm, setDropoffForm] = useState({
    name: '',
    phone: '',
    address: '',
    paci_number: '',
    lat: '',
    lng: '',
    area: '',
    block: '',
    street: '',
    building: '',
    floor: '',
    room: '',
  });

  const [fareLoading, setFareLoading] = useState(false);
  const [fareAmount, setFareAmount] = useState(null);
  const [fareError, setFareError] = useState('');
  const [paymentLoading, setPaymentLoading] = useState(false);
  const [paymentMethods, setPaymentMethods] = useState([]);
  const [methodModal, setMethodModal] = useState(false);
  const [selectedPaymentMethod, setSelectedPaymentMethod] = useState(null);

  const [mapTarget, setMapTarget] = useState(null); // branch | dropoff

  const [pickupOpen, setPickupOpen] = useState(false);
  const [branchModal, setBranchModal] = useState(false);
  const [mapModal, setMapModal] = useState(false);

  const [branchesLoading, setBranchesLoading] = useState(false);
  const [branches, setBranches] = useState([]);
  const [selectedBranch, setSelectedBranch] = useState(null);
  const [editingBranch, setEditingBranch] = useState(null);

  const [branchForm, setBranchForm] = useState({
    name: '',
    phone: '',
    address: '',
    lat: '',
    lng: '',
    area: '',
    block: '',
    street: '',
    building: '',
  });

  const authHeaders = {
    Accept: 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };

  useEffect(() => {
    fetchBranches();
    initMyFatoorah();
  }, []);

  useEffect(() => {
    if (!dropoffModal) return;

    const q = dropoffSearchText.trim();
    const isPaci = /^\d{6,}$/.test(q);

    if (q.length < 3) {
      setDropoffSuggestions([]);
      setDropoffSearching(false);
      return;
    }

    const timer = setTimeout(() => {
      if (isPaci) {
        lookupDropoffPaciAddress(q);
      } else {
        searchDropoffAddress(q);
      }
    }, 450);

    return () => clearTimeout(timer);
  }, [dropoffSearchText, dropoffModal]);

  const fetchBranches = async () => {
    try {
      setBranchesLoading(true);

      const res = await fetch(`${BASE_URL}/all_branches`, {
        method: 'GET',
        headers: authHeaders,
      });

      const json = await res.json();
      console.log('ALL BRANCHES:', json);

      const list = json?.branches || json?.data || json?.branch || [];
      setBranches(Array.isArray(list) ? list : []);
    } catch (e) {
      console.log('FETCH BRANCH ERROR:', e);
      setBranches([]);
    } finally {
      setBranchesLoading(false);
    }
  };

  const calculateFareEstimate = async (pickupLat, pickupLng, deliveryLat, deliveryLng) => {
    if (!pickupLat || !pickupLng || !deliveryLat || !deliveryLng) return;

    try {
      setFareLoading(true);
      setFareError('');
      setFareAmount(null);

      const fd = new FormData();
      fd.append('pickup_lat', String(pickupLat));
      fd.append('pickup_lng', String(pickupLng));
      fd.append('delivery_lat', String(deliveryLat));
      fd.append('delivery_lng', String(deliveryLng));

      const res = await fetch(`${BASE_URL}/fare`, {
        method: 'POST',
        headers: authHeaders,
        body: fd,
      });

      const json = await res.json();
      console.log('FARE ESTIMATE:', json);

      if (!res.ok || json?.success === false) {
        setFareError(json?.message || 'Unable to calculate fare');
        return;
      }

      setFareAmount(json?.fare ?? json?.data?.fare ?? json?.amount ?? null);
    } catch (e) {
      console.log('FARE ERROR:', e);
      setFareError('Unable to calculate fare');
    } finally {
      setFareLoading(false);
    }
  };

  const clearDropoffAutoData = (typedValue = '') => {
    setFareAmount(null);
    setFareError('');
    setDropoffAddress('');
    setDropoffLat('');
    setDropoffLng('');
    setDropoffSuggestions([]);

    const trimmed = String(typedValue || '').trim();
    const isPaci = /^\d{6,}$/.test(trimmed);

    setDropoffForm((prev) => ({
      ...prev,
      address: '',
      paci_number: isPaci ? trimmed : '',
      lat: '',
      lng: '',
      area: '',
      block: '',
      street: '',
      building: '',
      floor: '',
      room: '',
    }));
  };

  const applySelectedDropoffAddress = ({ address, lat, lng, parts = {}, paciNumber = '' }) => {
    setDropoffForm((prev) => ({
      ...prev,
      address: address || '',
      paci_number: paciNumber || prev.paci_number || '',
      lat: lat ? String(lat) : '',
      lng: lng ? String(lng) : '',
      area: parts?.area || '',
      block: parts?.block || '',
      street: parts?.street || '',
      building: parts?.building || '',
      floor: '',
      room: '',
    }));
  };

  const normalizeAddressCandidate = (item, index, fallbackText = '') => ({
    id: `${item?.location?.x || ''}-${item?.location?.y || ''}-${index}`,
    address: item?.address || fallbackText,
    lat: item?.location?.y ? String(item.location.y) : '',
    lng: item?.location?.x ? String(item.location.x) : '',
    score: item?.score,
    parts: parseKuwaitAddressParts(item),
    raw: item,
  });

  const fetchArcGisCandidates = async (query, maxLocations = 8) => {
    const singleLine = `${query.trim()} Kuwait`;
    const url =
      'https://geocode.arcgis.com/arcgis/rest/services/World/GeocodeServer/findAddressCandidates' +
      `?f=json&countryCode=KWT&maxLocations=${maxLocations}&outFields=*&SingleLine=${encodeURIComponent(singleLine)}`;

    const res = await fetch(url);
    const json = await res.json();
    return Array.isArray(json?.candidates) ? json.candidates : [];
  };

  const searchDropoffAddress = async (query) => {
    try {
      const trimmed = query.trim();

      // Manual text search only: show the dropdown list.
      // PACI number search is handled separately and will auto-select the matched address.
      if (/^\d{6,}$/.test(trimmed)) {
        setDropoffSuggestions([]);
        return;
      }

      setDropoffSearching(true);
      const candidates = await fetchArcGisCandidates(trimmed, 8);
      setDropoffSuggestions(candidates.map((item, index) => normalizeAddressCandidate(item, index, trimmed)));
    } catch (e) {
      console.log('DROPOFF ADDRESS SEARCH ERROR:', e);
      setDropoffSuggestions([]);
    } finally {
      setDropoffSearching(false);
    }
  };

  const lookupDropoffPaciAddress = async (paciNumber) => {
    try {
      const trimmed = paciNumber.trim();

      // PACI number flow: do not show suggestion dropdown. Auto-fill first matched result.
      setDropoffSearching(true);
      setDropoffSuggestions([]);

      const candidates = await fetchArcGisCandidates(trimmed, 1);
      const first = candidates?.[0];

      if (!first) {
        setDropoffForm((prev) => ({ ...prev, paci_number: trimmed }));
        return;
      }

      const item = normalizeAddressCandidate(first, 0, trimmed);

      applySelectedDropoffAddress({
        address: item.address,
        lat: item.lat,
        lng: item.lng,
        parts: item.parts,
        paciNumber: trimmed,
      });
    } catch (e) {
      console.log('DROPOFF PACI LOOKUP ERROR:', e);
      setDropoffSuggestions([]);
    } finally {
      setDropoffSearching(false);
    }
  };

  const selectDropoffSuggestion = (item) => {
    // Manual address result selected from dropdown.
    applySelectedDropoffAddress({
      address: item.address,
      lat: item.lat,
      lng: item.lng,
      parts: item.parts,
      paciNumber: '',
    });

    setDropoffSearchText(item.address || dropoffSearchText);
    setDropoffSuggestions([]);
    setDropoffSelectOpen(false);
  };

  const makeBranchFormData = () => {
    const fd = new FormData();

    fd.append('name', branchForm.name);
    fd.append('phone', branchForm.phone);
    fd.append('address', branchForm.address);
    fd.append('lat', branchForm.lat);
    fd.append('lng', branchForm.lng);
    fd.append('area', branchForm.area);
    fd.append('block', branchForm.block);
    fd.append('street', branchForm.street);
    fd.append('building', branchForm.building);

    return fd;
  };

  const resetBranchForm = () => {
    setBranchForm({
      name: '',
      phone: '',
      address: '',
      lat: '',
      lng: '',
      area: '',
      block: '',
      street: '',
      building: '',
    });
    setEditingBranch(null);
  };

  const openAddBranch = () => {
    resetBranchForm();
    setPickupOpen(false);
    setBranchModal(true);
  };

  const openEditBranch = (branch) => {
    const branchId = getBranchId(branch);

    setEditingBranch({ ...branch, id: branchId });

    setBranchForm({
      name: branch?.name || '',
      phone: branch?.phone || '',
      address: branch?.address || '',
      lat: String(branch?.lat || ''),
      lng: String(branch?.lng || ''),
      area: branch?.area || '',
      block: branch?.block || '',
      street: branch?.street || '',
      building: branch?.building || '',
    });

    setPickupOpen(false);
    setBranchModal(true);
  };

  const openMapPicker = () => {
    setMapTarget('branch');
    setBranchModal(false);
    setTimeout(() => setMapModal(true), 450);
  };

  const openDropoffPopup = () => {
    setDropoffSearchText(dropoffForm.address || dropoffAddress || '');
    setDropoffSelectOpen(false);
    setDropoffModal(true);
  };

  const openDropoffMapPicker = () => {
    setMapTarget('dropoff');
    setDropoffModal(false);
    setTimeout(() => setMapModal(true), 450);
  };

  const closeMapPicker = () => {
    setMapModal(false);

    if (mapTarget === 'branch') {
      setTimeout(() => setBranchModal(true), 450);
    }

    if (mapTarget === 'dropoff') {
      setTimeout(() => setDropoffModal(true), 450);
    }

    setMapTarget(null);
  };

  const onMapAddressSelected = (p) => {
    if (mapTarget === 'dropoff') {
      applySelectedDropoffAddress({
        address: p.address,
        lat: p.lat,
        lng: p.lng,
        parts: {},
        paciNumber: '',
      });

      setMapModal(false);

      setDropoffSelectOpen(false);

      setTimeout(() => {
        setDropoffModal(true);
        setMapTarget(null);
      }, 450);

      return;
    }

    setBranchForm((prev) => ({
      ...prev,
      address: p.address,
      lat: String(p.lat),
      lng: String(p.lng),
    }));

    setMapModal(false);

    setTimeout(() => {
      setBranchModal(true);
      setMapTarget(null);
    }, 450);
  };

  const saveDropoffDetails = () => {
    const manualAddress = dropoffForm.address.trim();
    const paciNumber = dropoffForm.paci_number.trim();

    if (!manualAddress) {
      Alert.alert('Validation', 'Please search address / PACI or select address from map');
      return;
    }

    if (!dropoffForm.lat || !dropoffForm.lng) {
      Alert.alert('Validation', 'Please select an address result or choose the exact location from map');
      return;
    }

    const finalAddress = paciNumber
      ? `PACI No: ${paciNumber} - ${manualAddress}`
      : manualAddress;

    setDropoffAddress(finalAddress);
    setDropoffLat(dropoffForm.lat);
    setDropoffLng(dropoffForm.lng);
    setDropoffModal(false);
    setDropoffSelectOpen(false);

    const pickupLat = selectedBranch?.lat || selectedBranch?.latitude;
    const pickupLng = selectedBranch?.lng || selectedBranch?.lon || selectedBranch?.longitude;

    if (pickupLat && pickupLng && dropoffForm.lat && dropoffForm.lng) {
      calculateFareEstimate(pickupLat, pickupLng, dropoffForm.lat, dropoffForm.lng);
    }
  };

  const saveBranch = async () => {
    if (!branchForm.name.trim() || !branchForm.phone.trim() || !branchForm.address.trim()) {
      Alert.alert('Validation', 'Name, phone and address are required');
      return;
    }

    try {
      const fd = makeBranchFormData();
      let url = `${BASE_URL}/add_branch`;

      const editingId = getBranchId(editingBranch);

      if (editingId) {
        url = `${BASE_URL}/update_branch`;

        // Backend may validate either id or branch_id.
        // all_branches returns "id", so send it in both fields.
        fd.append('id', String(editingId));
        fd.append('branch_id', String(editingId));
      }

      const res = await fetch(url, {
        method: 'POST',
        headers: authHeaders,
        body: fd,
      });

      const json = await res.json();
      console.log(editingId ? 'UPDATE BRANCH:' : 'ADD BRANCH:', json);

      if (!res.ok || json?.success === false) {
        Alert.alert('Error', json?.message || 'Branch save failed');
        return;
      }

      const savedBranch = json?.data || json?.branch || {
        ...branchForm,
        id: editingId || Date.now(),
      };

      setSelectedBranch(savedBranch);
      setBranchModal(false);
      resetBranchForm();
      fetchBranches();
    } catch (e) {
      console.log('SAVE BRANCH ERROR:', e);
      Alert.alert('Error', 'Something went wrong');
    }
  };

  const confirmDeleteBranch = (branch) => {
    Alert.alert(
      'Delete branch',
      'Are you sure you want to delete this branch?',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete', style: 'destructive', onPress: () => deleteBranch(branch) },
      ],
    );
  };

  const deleteBranch = async (branch) => {
    const branchId = getBranchId(branch);

    if (!branchId) {
      Alert.alert('Error', 'Branch id not found');
      return;
    }

    try {
      const fd = new FormData();

      // Backend may validate either id or branch_id.
      // all_branches returns "id", so send it in both fields.
      fd.append('id', String(branchId));
      fd.append('branch_id', String(branchId));

      const res = await fetch(`${BASE_URL}/delete_branch`, {
        method: 'POST',
        headers: authHeaders,
        body: fd,
      });

      const json = await res.json();
      console.log('DELETE BRANCH:', json);

      if (!res.ok || json?.success === false) {
        Alert.alert('Error', json?.message || 'Delete failed');
        return;
      }

      if (getBranchId(selectedBranch) === branchId) setSelectedBranch(null);

      fetchBranches();
    } catch (e) {
      console.log('DELETE BRANCH ERROR:', e);
      Alert.alert('Error', 'Something went wrong');
    }
  };

  const handlePayNow = async () => {
    if (paymentLoading) return;

    if (fareAmount === null || Number(fareAmount) <= 0) {
      Alert.alert('Fare required', 'Please calculate fare estimate first');
      return;
    }

    try {
      setPaymentLoading(true);

      const methods = await getMyFatoorahMethods(Number(fareAmount));

      if (!methods || methods.length === 0) {
        Alert.alert('Payment method', 'No payment methods available');
        return;
      }

      setPaymentMethods(methods);
      setSelectedPaymentMethod(methods[0]);
      setMethodModal(true);
    } catch (error) {
      console.log('MYFATOORAH METHODS ERROR:', error);
      Alert.alert('Payment error', error?.message || 'Unable to load payment methods');
    } finally {
      setPaymentLoading(false);
    }
  };

 const continueSelectedPayment = async () => {
   if (!selectedPaymentMethod) {
     Alert.alert('Payment method', 'Please select payment method');
     return;
   }

   try {
     setMethodModal(false);
     setPaymentLoading(true);

     const paymentReference = `ARSEL-PAY-${Date.now()}`;

     const paymentResult = await payWithMyFatoorah({
       amount: Number(fareAmount),
       paymentMethod: selectedPaymentMethod,
       customerName: receiverName || dropoffForm.name || 'Customer',
       customerMobile: receiverPhone || dropoffForm.phone || '90000000',
       customerEmail: 'customer@tryverdi.com',
       customerReference: paymentReference,
     });

     console.log(
       'MYFATOORAH PAYMENT RESULT:',
       JSON.stringify(paymentResult, null, 2)
     );

     const transactionId =
       paymentResult?.payment_transaction_id ||
       paymentResult?.TransactionId ||
       paymentResult?.transactionId ||
       paymentResult?.InvoiceTransactions?.[0]?.TransactionId ||
       paymentResult?.Data?.InvoiceTransactions?.[0]?.TransactionId ||
       paymentResult?.data?.InvoiceTransactions?.[0]?.TransactionId ||
       paymentResult?.invoiceTransactions?.[0]?.transactionId ||
       '';

     const paymentId =
       paymentResult?.payment_id ||
       paymentResult?.PaymentId ||
       paymentResult?.paymentId ||
       paymentResult?.Data?.PaymentId ||
       paymentResult?.data?.PaymentId ||
       paymentResult?.invoice_id ||
       paymentResult?.InvoiceId ||
       paymentResult?.invoiceId ||
       paymentResult?.Data?.InvoiceId ||
       paymentResult?.data?.InvoiceId ||
       '';

     const invoiceId =
       paymentResult?.invoice_id ||
       paymentResult?.InvoiceId ||
       paymentResult?.invoiceId ||
       paymentResult?.Data?.InvoiceId ||
       paymentResult?.data?.InvoiceId ||
       '';

     console.log('MYFATOORAH TransactionId:', transactionId);
     console.log('MYFATOORAH PaymentId / InvoiceId used as payment_id:', paymentId);
     console.log('MYFATOORAH InvoiceId:', invoiceId);

     const orderId = transactionId
       ? `ORDER-${transactionId}`
       : `ORDER-${invoiceId || paymentId || Date.now()}`;

     console.log('ORDER ID:', orderId);

     if (!paymentId) {
       Alert.alert('Payment error', 'Payment ID not received from MyFatoorah');
       return;
     }

     const pickupLat = String(selectedBranch?.lat || selectedBranch?.latitude || '');
     const pickupLng = String(selectedBranch?.lng || selectedBranch?.lon || selectedBranch?.longitude || '');
     const pickupName = String(selectedBranch?.name || branchForm.name || 'Verdi Sender');
     const pickupPhone = String(selectedBranch?.phone || branchForm.phone || receiverPhone || dropoffForm.phone || '');
     const pickupAddress = String(selectedBranch?.address || branchForm.address || '');

     const receiverFinalName = receiverName || dropoffForm.name || 'Customer';
     const receiverFinalPhone = receiverPhone || dropoffForm.phone || '90000000';

     const payerType = payer === 'receiver' ? 'receiver' : 'sender';
     const payerName = payerType === 'receiver' ? receiverFinalName : pickupName;
     const payerPhone = payerType === 'receiver' ? receiverFinalPhone : pickupPhone;

     const createTaskBody = {
       customer_name: receiverFinalName,
       customer_phone: receiverFinalPhone,
       order_id: orderId,
       order_description: 'Small parcel delivery',

       pickup_name: pickupName,
       pickup_phone: pickupPhone,
       pickup_address: pickupAddress,
       pickup_lat: Number(pickupLat),
       pickup_lng: Number(pickupLng),

       delivery_address: String(dropoffAddress || dropoffForm.address || ''),
       delivery_lat: Number(dropoffLat || dropoffForm.lat || 0),
       delivery_lng: Number(dropoffLng || dropoffForm.lng || 0),

       payment_type: getPaymentType(selectedPaymentMethod),
       order_amount: Number(fareAmount),
       platform: 'customer_app',

       // Send MyFatoorah InvoiceId separately to backend.
       invoice_id: String(invoiceId || paymentId),

       // Keep payment_id also for backend validation.
       // If SDK does not return PaymentId, invoiceId is used.
       payment_id: String(paymentId),
       payment_transaction_id: String(transactionId || ''),

       payer_type: payerType,
       payer_name: payerName,
       payer_phone: payerPhone,
       payer_email: 'customer@tryverdi.com',
     };

     console.log('CREATE TASK BODY:', createTaskBody);

     const res = await fetch(`${BASE_URL}/create_task`, {
       method: 'POST',
       headers: {
         ...authHeaders,
         'Content-Type': 'application/json',
       },
       body: JSON.stringify(createTaskBody),
     });

     const json = await res.json();
     console.log('CREATE TASK AFTER PAYMENT:', json);

     if (!res.ok || json?.success === false) {
       Alert.alert('Order failed', json?.message || json?.error || 'Payment done but order creation failed');
       return;
     }

     const createdTask = json?.task || json?.data || json?.order || json;

     globalThis.__ARSEL_LAST_ORDER = {
       ...createTaskBody,
       ...createdTask,
       raw_response: json,
       order_id:
         createdTask?.order_id ||
         createdTask?.orderId ||
         createdTask?.task_id ||
         createdTask?.id ||
         createTaskBody.order_id,
       tracking_code:
         createdTask?.tracking_code ||
         createdTask?.trackingCode ||
         createdTask?.tracking_id ||
         createdTask?.trackingId ||
         createdTask?.code ||
         createTaskBody.order_id,
       status:
         createdTask?.status ||
         createdTask?.task_status ||
         createdTask?.order_status ||
         'Order placed',
     };

     console.log('TRACKING ORDER DATA:', globalThis.__ARSEL_LAST_ORDER);

     Alert.alert('Payment success', 'Order created successfully');
     go('tracking');
   } catch (error) {
     console.log('MYFATOORAH PAYMENT ERROR:', error);
     Alert.alert('Payment failed', error?.message || 'Payment cancelled');
   } finally {
     setPaymentLoading(false);
   }
 };

  const selectedPickupText = selectedBranch
    ? selectedBranch.address || selectedBranch.name
    : '';

  const canContinue =
    !!selectedBranch &&
    (hasAddress
      ? receiverName.trim() &&
        receiverPhone.trim() &&
        dropoffAddress.trim() &&
        (payer === 'receiver' || (fareAmount !== null && !fareLoading && !paymentLoading))
      : receiverName.trim() && receiverPhone.trim()) &&
    (!later || selectedTime !== '');

  const buttonText = !hasAddress
    ? arabic
      ? 'إرسال طلب واتساب'
      : 'Send WhatsApp request'
    : payer === 'receiver'
      ? arabic
        ? 'إرسال طلب للمستلم'
        : 'Send request to receiver'
      : arabic
        ? 'المتابعة للدفع'
        : 'Continue to payment';

  return (
    <View style={s.page}>
      <View style={s.header}>
        <Pressable onPress={() => go('home')}>
          <Feather name="chevron-left" size={23} />
        </Pressable>

        <Text style={s.head}>
          {later ? (arabic ? 'إرسال لاحقاً' : 'Send later') : arabic ? 'إرسال الآن' : 'Send now'}
        </Text>
      </View>

      <ScrollView contentContainerStyle={s.content} keyboardShouldPersistTaps="handled">
        <View style={s.deliveryBanner}>
          <View style={s.bannerIcon}>
            <Feather name={later ? 'clock' : 'zap'} size={18} color={COLORS.green} />
          </View>

          <View style={{ flex: 1 }}>
            <Text style={s.bannerTitle}>
              {later ? (arabic ? 'توصيل مجدول' : 'Scheduled delivery') : arabic ? 'توصيل فوري' : 'Instant delivery'}
            </Text>

            <Text style={s.bannerSub}>
              {later
                ? arabic
                  ? 'اختر وقت الاستلام أدناه'
                  : 'Pick a pickup time below'
                : arabic
                  ? 'سيتم إرسال المندوب فور التأكيد'
                  : 'Courier dispatched immediately after you confirm'}
            </Text>
          </View>
        </View>

        <Text style={s.label}>{arabic ? 'عنوان الاستلام' : 'PICKUP ADDRESS'}</Text>

        <Pressable
          style={[s.pickupBox, selectedPickupText && s.pickupBoxSmall]}
          onPress={() => setPickupOpen(!pickupOpen)}
        >
          <View style={[s.addrIcon, selectedPickupText && s.addrIconSmall]}>
            <Feather name="home" size={selectedPickupText ? 15 : 17} color={COLORS.green} />
          </View>

          <Text
            numberOfLines={selectedPickupText ? 1 : 2}
            style={[
              s.pickupText,
              selectedPickupText && s.pickupTextSmall,
              !selectedPickupText && { color: '#7A7E83' },
            ]}
          >
            {selectedPickupText || (arabic ? 'اختر عنوان الاستلام' : 'Select pickup address')}
          </Text>

          <Feather name={pickupOpen ? 'chevron-up' : 'chevron-down'} size={20} color="#777" />
        </Pressable>

        {pickupOpen && (
          <View style={s.dropdown}>
            {branchesLoading ? (
              <View style={s.loadingRow}>
                <ActivityIndicator size="small" color={COLORS.green} />
                <Text style={s.emptyText}>{arabic ? 'جاري التحميل...' : 'Loading...'}</Text>
              </View>
            ) : branches.length > 0 ? (
              <>
                {branches.map((item, index) => (
                  <View key={getBranchId(item) || index} style={s.branchItem}>
                    <Pressable
                      style={{ flex: 1 }}
                      onPress={() => {
                        setSelectedBranch(item);
                        setPickupOpen(false);

                        const pLat = item?.lat || item?.latitude;
                        const pLng = item?.lng || item?.lon || item?.longitude;

                        if (pLat && pLng && dropoffLat && dropoffLng) {
                          calculateFareEstimate(pLat, pLng, dropoffLat, dropoffLng);
                        }
                      }}
                    >
                      <Text style={s.branchName}>{item.name || 'Branch'}</Text>
                      <Text style={s.branchAddress} numberOfLines={2}>{item.address || ''}</Text>
                    </Pressable>

                    <View style={s.branchActions}>
                      <Pressable onPress={() => openEditBranch(item)} hitSlop={10}>
                        <Feather name="edit-2" size={18} color={COLORS.green} />
                      </Pressable>

                      <Pressable onPress={() => confirmDeleteBranch(item)} hitSlop={10}>
                        <Feather name="trash-2" size={18} color="#E53935" />
                      </Pressable>
                    </View>
                  </View>
                ))}

                <Pressable style={s.createBranch} onPress={openAddBranch}>
                  <Feather name="plus-circle" size={18} color={COLORS.green} />
                  <Text style={s.createBranchText}>
                    {arabic ? 'إنشاء فرع جديد' : 'Create new branch'}
                  </Text>
                </Pressable>
              </>
            ) : (
              <Pressable style={s.createBranch} onPress={openAddBranch}>
                <Feather name="plus-circle" size={18} color={COLORS.green} />
                <Text style={s.createBranchText}>{arabic ? 'إنشاء فرع' : 'Create branch'}</Text>
              </Pressable>
            )}
          </View>
        )}

        <Text style={s.label}>{arabic ? 'المستلم' : 'RECIPIENT'}</Text>

        <View style={s.inputCard}>
          <InputRow
            icon="user"
            value={receiverName}
            onChangeText={setReceiverName}
            placeholder={arabic ? 'اسم المستلم' : 'Receiver name'}
          />

          <Line />

          <InputRow
            icon="phone"
            value={receiverPhone}
            onChangeText={setReceiverPhone}
            placeholder={arabic ? 'رقم الواتساب' : 'WhatsApp number'}
            keyboardType="phone-pad"
          />
        </View>

        <Text style={s.label}>{arabic ? 'عنوان التسليم' : 'DELIVERY ADDRESS'}</Text>

        <View style={s.card}>
          <Choice
            checked={hasAddress}
            onPress={() => setHasAddress(true)}
            title={arabic ? 'لدي العنوان' : 'I have the address'}
            sub={
              arabic
                ? 'أدخل العنوان الآن وسيتم الإرسال فوراً'
                : "Enter it now and we'll dispatch instantly"
            }
          />

          <Line inset />

          <Choice
            checked={!hasAddress}
            onPress={() => setHasAddress(false)}
            title={arabic ? 'ليس لدي العنوان' : "I don't have the address"}
            sub={
              arabic
                ? 'سنرسل لهم رسالة لمشاركة موقعهم'
                : "We'll text them to share their location"
            }
          />
        </View>

        {hasAddress ? (
          <>
            <Pressable style={[s.address, dropoffAddress && s.dropoffAddressSmall]} onPress={openDropoffPopup}>
              <View style={[s.addrIcon, dropoffAddress && s.addrIconSmall]}>
                <Feather name="map-pin" size={dropoffAddress ? 15 : 17} color={COLORS.green} />
              </View>

              <Text
                numberOfLines={dropoffAddress ? 1 : 2}
                style={[
                  s.addressPickerText,
                  dropoffAddress && s.dropoffTextSmall,
                  !dropoffAddress && { color: '#7A7E83' },
                ]}
              >
                {dropoffAddress || (arabic ? 'أضف عنوان التسليم' : 'Add dropoff address')}
              </Text>

              <Feather name="chevron-right" size={18} color="#777" />
            </Pressable>

            {(fareLoading || fareAmount !== null || fareError) && (
              <View style={s.fareBox}>
                <View style={s.fareIcon}>
                  <Feather name="navigation" size={18} color={COLORS.green} />
                </View>

                <View style={{ flex: 1 }}>
                  <Text style={s.fareTitle}>
                    {arabic ? 'تقدير السعر' : 'Fare estimate'}
                  </Text>

                  {fareLoading ? (
                    <Text style={s.fareSub}>{arabic ? 'جاري الحساب...' : 'Calculating...'}</Text>
                  ) : fareError ? (
                    <Text style={s.fareError}>{fareError}</Text>
                  ) : (
                    <Text style={s.fareValue}>
                      {fareAmount} {arabic ? 'د.ك' : 'KD'}
                    </Text>
                  )}
                </View>
              </View>
            )}
          </>
        ) : null}

        {later && hasAddress && (
          <>
            <Text style={s.label}>{arabic ? 'وقت الاستلام' : 'PICKUP TIME'}</Text>

            <View style={s.timeCard}>
              {times.map((t) => {
                const isSelected = selectedTime === t;

                return (
                  <Pressable
                    key={t}
                    style={[s.time, isSelected && s.timeSelected]}
                    onPress={() => setSelectedTime(t)}
                  >
                    <Text style={[s.timeText, isSelected && s.timeTextSelected]}>
                      {t}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </>
        )}

        <Text style={s.label}>{arabic ? 'من سيدفع؟' : 'WHO PAYS?'}</Text>

        <View style={s.card}>
          <Pay
            checked={payer === 'me'}
            onPress={() => setPayer('me')}
            icon="credit-card"
            title={arabic ? 'سأدفع' : "I'll pay"}
            sub={arabic ? 'ادفع الآن باستخدام بطاقتك المحفوظة' : 'Pay now with your saved card'}
          />

          <Line inset />

          <Pay
            checked={payer === 'receiver'}
            onPress={() => setPayer('receiver')}
            icon="box"
            title={arabic ? 'المستلم يدفع' : 'Receiver pays'}
            sub={
              arabic
                ? 'سيحصل على رابط دفع آمن عبر واتساب'
                : 'They get a secure payment link on WhatsApp'
            }
          />
        </View>

        <View style={{ height: 150 }} />
      </ScrollView>

      <View style={s.fixed}>
        <Pressable
          disabled={!canContinue}
          onPress={() => {
            if (!canContinue) return;
            if (!hasAddress || payer === 'receiver') go('requestSent');
            else handlePayNow();
          }}
          style={[s.pay, !canContinue && s.payDisabled]}
        >
          {paymentLoading ? (
            <ActivityIndicator size="small" color="#111" />
          ) : (
            <Text style={[s.payText, !canContinue && s.payTextDisabled]}>
              {buttonText}
            </Text>
          )}
        </Pressable>

        <Text style={s.cancel}>{arabic ? 'إلغاء' : 'Cancel'}</Text>
      </View>

      <Modal
        visible={branchModal}
        transparent
        animationType="slide"
        onRequestClose={() => {
          setBranchModal(false);
          resetBranchForm();
        }}
      >
        <View style={s.modalOverlay}>
          <View style={s.modalBox}>
            <View style={s.modalHead}>
              <Text style={s.modalTitle}>
                {editingBranch
                  ? arabic
                    ? 'تحديث الفرع'
                    : 'Update branch'
                  : arabic
                    ? 'إنشاء فرع'
                    : 'Create branch'}
              </Text>

              <Pressable
                onPress={() => {
                  setBranchModal(false);
                  resetBranchForm();
                }}
              >
                <Feather name="x" size={22} color="#111" />
              </Pressable>
            </View>

            <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
              <BranchInput
                placeholder={arabic ? 'الاسم' : 'Name'}
                value={branchForm.name}
                onChangeText={(v) => setBranchForm({ ...branchForm, name: v })}
              />

              <BranchInput
                placeholder={arabic ? 'رقم الهاتف' : 'Phone'}
                value={branchForm.phone}
                onChangeText={(v) => setBranchForm({ ...branchForm, phone: v })}
                keyboardType="phone-pad"
              />

              <Pressable style={s.addressPicker} onPress={openMapPicker}>
                <Feather name="map-pin" size={18} color={COLORS.green} />

                <Text style={[s.addressPickerText, !branchForm.address && { color: '#7A7E83' }]} numberOfLines={2}>
                  {branchForm.address || (arabic ? 'اختر العنوان من الخريطة' : 'Select address from map')}
                </Text>
              </Pressable>

              <BranchInput
                placeholder={arabic ? 'المنطقة' : 'Area'}
                value={branchForm.area}
                onChangeText={(v) => setBranchForm({ ...branchForm, area: v })}
              />

              <BranchInput
                placeholder={arabic ? 'القطعة' : 'Block'}
                value={branchForm.block}
                onChangeText={(v) => setBranchForm({ ...branchForm, block: v })}
              />

              <BranchInput
                placeholder={arabic ? 'الشارع' : 'Street'}
                value={branchForm.street}
                onChangeText={(v) => setBranchForm({ ...branchForm, street: v })}
              />

              <BranchInput
                placeholder={arabic ? 'المبنى' : 'Building'}
                value={branchForm.building}
                onChangeText={(v) => setBranchForm({ ...branchForm, building: v })}
              />

              <Pressable style={s.saveBtn} onPress={saveBranch}>
                <Text style={s.saveText}>
                  {editingBranch
                    ? arabic
                      ? 'تحديث الفرع'
                      : 'Update branch'
                    : arabic
                      ? 'حفظ الفرع'
                      : 'Save branch'}
                </Text>
              </Pressable>

              <Pressable
                onPress={() => {
                  setBranchModal(false);
                  resetBranchForm();
                }}
              >
                <Text style={s.closeText}>{arabic ? 'إغلاق' : 'Close'}</Text>
              </Pressable>
            </ScrollView>
          </View>
        </View>
      </Modal>

      <Modal
        visible={dropoffModal}
        transparent
        animationType="slide"
        onRequestClose={() => setDropoffModal(false)}
      >
        <View style={s.modalOverlay}>
          <View style={s.modalBox}>
            <View style={s.modalHead}>
              <Text style={s.modalTitle}>
                {arabic ? 'تفاصيل عنوان التسليم' : 'Dropoff address details'}
              </Text>

              <Pressable onPress={() => setDropoffModal(false)}>
                <Feather name="x" size={22} color="#111" />
              </Pressable>
            </View>

            <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
              <Text style={s.selectAddressTitle}>
                {arabic ? 'اختر العنوان' : 'SELECT ADDRESS'}
              </Text>

              <Pressable
                style={s.addressSelectBox}
                onPress={() => setDropoffSelectOpen(!dropoffSelectOpen)}
              >
                <View style={s.addressSelectIcon}>
                  <Feather name="map-pin" size={15} color={COLORS.green} />
                </View>

                <View style={{ flex: 1 }}>
                  <Text
                    numberOfLines={1}
                    style={[s.addressSelectValue, !dropoffForm.address && { color: '#7A7E83' }]}
                  >
                    {dropoffForm.address || (arabic ? 'بحث العنوان / PACI أو الخريطة' : 'Search address / PACI or select from map')}
                  </Text>
                </View>

                <Feather name={dropoffSelectOpen ? 'chevron-up' : 'chevron-down'} size={20} color="#777" />
              </Pressable>

              {dropoffSelectOpen && (
                <View style={s.addressDropdown}>
                  <View style={s.searchBox}>
                    <View style={s.searchIconCircle}>
                      <Feather name="search" size={17} color={COLORS.green} />
                    </View>
                    <TextInput
                      value={dropoffSearchText}
                      onChangeText={(v) => {
                        setDropoffSearchText(v);
                        setDropoffSelectOpen(true);
                        clearDropoffAutoData(v);
                      }}
                      placeholder={arabic ? 'ابحث بالعنوان أو رقم PACI' : 'Search address or PACI number'}
                      placeholderTextColor="#7A7E83"
                      keyboardType="default"
                      style={s.searchInput}
                    />
                    {dropoffSearching ? <ActivityIndicator size="small" color={COLORS.green} /> : null}
                  </View>

                  {dropoffSearchText.trim().length > 0 && dropoffSearchText.trim().length < 3 ? (
                    <Text style={s.searchHint}>
                      {arabic ? 'اكتب 3 أحرف على الأقل' : 'Type minimum 3 characters'}
                    </Text>
                  ) : null}

                  {/^\d{6,}$/.test(dropoffSearchText.trim()) && !dropoffSearching && dropoffForm.lat && dropoffForm.lng ? (
                    <Text style={s.searchHint}>
                      {arabic ? 'تم العثور على العنوان برقم PACI وتعبئة البيانات' : 'PACI address found and fields auto-filled'}
                    </Text>
                  ) : null}

                  {/^\d{6,}$/.test(dropoffSearchText.trim()) && !dropoffSearching && (!dropoffForm.lat || !dropoffForm.lng) ? (
                    <Text style={s.searchHint}>
                      {arabic ? 'أدخل رقم PACI صحيح للعثور على العنوان' : 'Enter a valid PACI number to auto-fill address'}
                    </Text>
                  ) : null}

                  {!/^\d{6,}$/.test(dropoffSearchText.trim()) && dropoffSuggestions.map((item) => (
                    <Pressable
                      key={item.id}
                      style={s.suggestionRow}
                      onPress={() => selectDropoffSuggestion(item)}
                    >
                      <Feather name="map-pin" size={17} color={COLORS.green} />
                      <View style={{ flex: 1 }}>
                        <Text style={s.suggestionTitle} numberOfLines={2}>{item.address}</Text>
                        <Text style={s.suggestionSub} numberOfLines={1}>
                          {[item.parts?.area, item.parts?.block ? `Block ${item.parts.block}` : '', item.parts?.street].filter(Boolean).join(' • ') ||
                            (item.lat && item.lng ? `${Number(item.lat).toFixed(5)}, ${Number(item.lng).toFixed(5)}` : '')}
                        </Text>
                      </View>
                    </Pressable>
                  ))}

                  <Pressable
                    style={s.mapOptionRow}
                    onPress={openDropoffMapPicker}
                  >
                    <View style={s.mapOptionIcon}>
                      <Feather name="map" size={18} color={COLORS.green} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={s.mapOptionTitle}>
                        {arabic ? 'اختر العنوان من الخريطة' : 'Select address from map'}
                      </Text>
                      <Text style={s.mapOptionSub}>
                        {arabic ? 'حدد الموقع الدقيق واضغط Use this address' : 'Pick exact location and tap Use this address'}
                      </Text>
                    </View>
                    <Feather name="chevron-right" size={18} color="#777" />
                  </Pressable>
                </View>
              )}

              <View style={s.formRow}>
                <BranchInput
                  half
                  placeholder={arabic ? 'المنطقة' : 'Area'}
                  value={dropoffForm.area}
                  onChangeText={(v) => setDropoffForm({ ...dropoffForm, area: v })}
                />

                <BranchInput
                  half
                  placeholder={arabic ? 'القطعة' : 'Block'}
                  value={dropoffForm.block}
                  onChangeText={(v) => setDropoffForm({ ...dropoffForm, block: v })}
                />
              </View>

              <View style={s.formRow}>
                <BranchInput
                  half
                  placeholder={arabic ? 'الشارع' : 'Street'}
                  value={dropoffForm.street}
                  onChangeText={(v) => setDropoffForm({ ...dropoffForm, street: v })}
                />

                <BranchInput
                  half
                  placeholder={arabic ? 'المبنى' : 'Building'}
                  value={dropoffForm.building}
                  onChangeText={(v) => setDropoffForm({ ...dropoffForm, building: v })}
                />
              </View>

              <View style={s.formRow}>
                <BranchInput
                  half
                  placeholder={arabic ? 'الطابق' : 'Floor'}
                  value={dropoffForm.floor}
                  onChangeText={(v) => setDropoffForm({ ...dropoffForm, floor: v })}
                />

                <BranchInput
                  half
                  placeholder={arabic ? 'الغرفة' : 'Room'}
                  value={dropoffForm.room}
                  onChangeText={(v) => setDropoffForm({ ...dropoffForm, room: v })}
                />
              </View>

              <Pressable style={s.saveBtn} onPress={saveDropoffDetails}>
                <Text style={s.saveText}>
                  {arabic ? 'حفظ عنوان التسليم' : 'Save dropoff address'}
                </Text>
              </Pressable>

              <Pressable onPress={() => setDropoffModal(false)}>
                <Text style={s.closeText}>{arabic ? 'إغلاق' : 'Close'}</Text>
              </Pressable>
            </ScrollView>
          </View>
        </View>
      </Modal>


      <Modal
        visible={methodModal}
        transparent
        animationType="slide"
        onRequestClose={() => setMethodModal(false)}
      >
        <View style={s.modalOverlay}>
          <View style={s.modalBox}>
            <View style={s.modalHead}>
              <Text style={s.modalTitle}>{arabic ? 'اختر طريقة الدفع' : 'Choose Payment Method'}</Text>

              <Pressable onPress={() => setMethodModal(false)}>
                <Feather name="x" size={22} color="#111" />
              </Pressable>
            </View>

            {paymentMethods.map((method, index) => {
              const name =
                method.PaymentMethodEn ||
                method.paymentMethodEn ||
                method.PaymentMethodName ||
                method.paymentMethodName ||
                'Payment method';

              const checked = selectedPaymentMethod === method;

              return (
                <Pressable
                  key={index}
                  style={s.paymentMethodRow}
                  onPress={() => setSelectedPaymentMethod(method)}
                >
                  <View style={[s.radio, checked && s.payRadio]} />

                  <View style={{ flex: 1 }}>
                    <Text style={s.choiceTitle}>{name}</Text>
                    <Text style={s.sub}>{arabic ? 'ادفع بأمان' : `Pay securely with ${name}`}</Text>
                  </View>
                </Pressable>
              );
            })}

            <Pressable style={s.saveBtn} onPress={continueSelectedPayment}>
              <Text style={s.saveText}>{arabic ? 'متابعة' : 'Continue'}</Text>
            </Pressable>

            <Pressable onPress={() => setMethodModal(false)}>
              <Text style={s.closeText}>{arabic ? 'إلغاء' : 'Cancel'}</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      <ArcGisAddressMap
        visible={mapModal}
        title={
          mapTarget === 'dropoff'
            ? arabic
              ? 'اختر عنوان التسليم'
              : 'Select dropoff address'
            : arabic
              ? 'اختر عنوان الاستلام'
              : 'Select pickup address'
        }
        onClose={closeMapPicker}
        onSelect={onMapAddressSelected}
      />
    </View>
  );
}

function InputRow({ icon, value, onChangeText, placeholder, keyboardType }) {
  return (
    <View style={s.row}>
      <Feather name={icon} size={18} color="#777" />

      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor="#7A7E83"
        keyboardType={keyboardType || 'default'}
        style={s.input}
      />
    </View>
  );
}

function BranchInput({ placeholder, value, onChangeText, keyboardType, half }) {
  return (
    <TextInput
      value={value}
      onChangeText={onChangeText}
      placeholder={placeholder}
      placeholderTextColor="#7A7E83"
      keyboardType={keyboardType || 'default'}
      style={[s.branchInput, half && s.branchInputHalf]}
    />
  );
}

function Choice({ checked, title, sub, onPress }) {
  return (
    <Pressable style={s.choice} onPress={onPress}>
      <View style={[s.radio, checked && s.check]}>
        {checked && <Feather name="check" size={18} />}
      </View>

      <View style={{ flex: 1 }}>
        <Text style={s.choiceTitle}>{title}</Text>
        <Text style={s.sub}>{sub}</Text>
      </View>
    </Pressable>
  );
}

function Pay({ checked, icon, title, sub, onPress }) {
  return (
    <Pressable style={s.choice} onPress={onPress}>
      <View style={[s.radio, checked && s.payRadio]} />

      <View style={s.payIcon}>
        <Feather name={icon} size={17} color={COLORS.green} />
      </View>

      <View style={{ flex: 1 }}>
        <Text style={s.choiceTitle}>{title}</Text>
        <Text style={s.sub}>{sub}</Text>
      </View>
    </Pressable>
  );
}

function Line({ inset }) {
  return <View style={[s.line, inset && { marginLeft: 76 }]} />;
}

const s = StyleSheet.create({
  page: { flex: 1, backgroundColor: '#FAFBF9' },

  header: {
    height: 96,
    paddingTop: 48,
    paddingHorizontal: 28,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 22,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },

  head: { fontSize: 20, fontWeight: '800', color: '#111' },

  content: { paddingHorizontal: 28, paddingTop: 22 },

  deliveryBanner: {
    height: 70,
    borderRadius: 22,
    backgroundColor: '#EDFFE1',
    borderWidth: 1,
    borderColor: '#D8F7A8',
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 18,
    marginBottom: 22,
  },

  bannerIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },

  bannerTitle: { fontSize: 16, fontWeight: '800', color: '#111' },
  bannerSub: { fontSize: 13, color: '#666', marginTop: 2 },

  label: {
    fontSize: 15,
    fontWeight: '700',
    letterSpacing: 1,
    color: '#7B8085',
    marginTop: 18,
    marginBottom: 10,
  },

  inputCard: {
    borderRadius: 26,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#E5E5E5',
    overflow: 'hidden',
    marginBottom: 18,
    ...shadow,
  },

  row: {
    height: 60,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingHorizontal: 20,
  },

  input: { flex: 1, fontSize: 16, color: '#111', padding: 0 },
  addressInput: { flex: 1, fontSize: 16, color: '#111', padding: 0 },

  line: { height: 1, backgroundColor: '#E6E6E6' },

  card: {
    borderRadius: 26,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#E5E5E5',
    overflow: 'hidden',
    ...shadow,
  },

  choice: {
    minHeight: 74,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingHorizontal: 20,
    paddingVertical: 10,
  },

  radio: {
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 2,
    borderColor: '#E1E1E1',
    alignItems: 'center',
    justifyContent: 'center',
  },

  check: { backgroundColor: COLORS.green, borderColor: COLORS.green },
  payRadio: { borderColor: COLORS.green, borderWidth: 4 },

  choiceTitle: { fontSize: 16, fontWeight: '700', color: '#111' },
  sub: { fontSize: 13, color: '#7A7E83', marginTop: 2, lineHeight: 18 },

  pickupBox: {
    minHeight: 74,
    borderRadius: 26,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#E5E5E5',
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    gap: 14,
    ...shadow,
  },

  pickupBoxSmall: {
    minHeight: 56,
    borderRadius: 22,
    paddingHorizontal: 16,
  },

  pickupText: { flex: 1, fontSize: 16, color: '#111', fontWeight: '600' },

  pickupTextSmall: {
    fontSize: 14,
    fontWeight: '600',
  },

  dropdown: {
    backgroundColor: '#fff',
    borderRadius: 22,
    borderWidth: 1,
    borderColor: '#E5E5E5',
    marginTop: 8,
    overflow: 'hidden',
    ...shadow,
  },

  loadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 18,
    paddingVertical: 16,
  },

  emptyText: { fontSize: 14, color: '#777' },

  branchItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 18,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },

  branchName: { fontSize: 15, fontWeight: '800', color: '#111' },
  branchAddress: { fontSize: 13, color: '#777', marginTop: 3 },
  branchActions: { flexDirection: 'row', gap: 16, marginLeft: 12 },

  createBranch: {
    minHeight: 54,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 18,
    paddingVertical: 14,
  },

  createBranchText: { fontSize: 15, fontWeight: '800', color: COLORS.green },

  address: {
    height: 74,
    borderRadius: 26,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#E5E5E5',
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    gap: 14,
    marginTop: 16,
    ...shadow,
  },

  addrIcon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: COLORS.greenSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },

  addrIconSmall: {
    width: 34,
    height: 34,
    borderRadius: 17,
  },

  timeCard: {
    borderRadius: 26,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#E5E5E5',
    padding: 18,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    ...shadow,
  },

  time: {
    height: 44,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: '#E3E3E3',
    width: '30.5%',
    alignItems: 'center',
    justifyContent: 'center',
  },

  timeSelected: {
    backgroundColor: COLORS.green,
    borderColor: COLORS.green,
    shadowColor: COLORS.green,
    shadowOpacity: 0.35,
    shadowRadius: 10,
    elevation: 6,
  },

  timeText: { fontSize: 15, color: '#151515', fontWeight: '500' },
  timeTextSelected: { color: '#111', fontWeight: '800' },

  payIcon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: COLORS.greenSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },

  fixed: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 20,
    alignItems: 'center',
  },

  pay: {
    height: 60,
    borderRadius: 30,
    backgroundColor: COLORS.green,
    marginHorizontal: 28,
    alignSelf: 'stretch',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: COLORS.green,
    shadowOpacity: 0.35,
    shadowRadius: 16,
    elevation: 8,
  },

  payDisabled: { backgroundColor: '#D8F7A8' },
  payText: { fontSize: 18, fontWeight: '800', color: '#111' },
  payTextDisabled: { color: '#8B959B' },

  cancel: { fontSize: 15, color: '#666', marginTop: 14 },

  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.35)',
    justifyContent: 'flex-end',
  },

  modalBox: {
    maxHeight: '88%',
    backgroundColor: '#fff',
    borderTopLeftRadius: 30,
    borderTopRightRadius: 30,
    padding: 24,
    paddingBottom: 34,
  },

  modalHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 16,
  },

  modalTitle: { fontSize: 22, fontWeight: '900', color: '#111' },

  branchInput: {
    height: 52,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#E5E5E5',
    paddingHorizontal: 16,
    fontSize: 15,
    color: '#111',
    marginBottom: 10,
    backgroundColor: '#FAFBF9',
  },

  formRow: {
    flexDirection: 'row',
    gap: 10,
  },

  branchInputHalf: {
    flex: 1,
  },

  addressPicker: {
    minHeight: 52,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#E5E5E5',
    paddingHorizontal: 16,
    marginBottom: 10,
    backgroundColor: '#FAFBF9',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },

  addressPickerText: {
    flex: 1,
    fontSize: 15,
    color: '#111',
  },

  saveBtn: {
    height: 56,
    borderRadius: 28,
    backgroundColor: COLORS.green,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 8,
  },

  saveText: { fontSize: 17, fontWeight: '900', color: '#111' },

  closeText: {
    textAlign: 'center',
    fontSize: 15,
    fontWeight: '700',
    color: '#666',
    marginTop: 14,
  },


  dropoffAddressSmall: {
    height: 56,
    borderRadius: 22,
    paddingHorizontal: 16,
  },

  dropoffTextSmall: {
    fontSize: 14,
    fontWeight: '600',
  },

  fareBox: {
    minHeight: 76,
    borderRadius: 22,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#E5E5E5',
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 18,
    gap: 12,
    marginTop: 12,
    ...shadow,
  },

  fareIcon: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: COLORS.greenSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },

  fareTitle: {
    fontSize: 14,
    fontWeight: '800',
    color: '#111',
  },

  fareSub: {
    fontSize: 13,
    color: '#777',
    marginTop: 3,
  },

  fareValue: {
    fontSize: 20,
    fontWeight: '900',
    color: '#111',
    marginTop: 3,
  },

  fareError: {
    fontSize: 13,
    color: '#E53935',
    marginTop: 3,
  },



  selectAddressTitle: {
    fontSize: 12,
    fontWeight: '900',
    color: '#8B959B',
    letterSpacing: 1,
    marginBottom: 8,
    marginLeft: 2,
  },

  addressSelectBox: {
    minHeight: 64,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#E5E5E5',
    backgroundColor: '#FAFBF9',
    paddingHorizontal: 14,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 10,
  },


  addressSelectIcon: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: COLORS.greenSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },

  searchIconCircle: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: COLORS.greenSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },

  addressSelectValue: {
    fontSize: 15,
    fontWeight: '700',
    color: '#111',
  },

  addressDropdown: {
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#E5E5E5',
    backgroundColor: '#fff',
    overflow: 'hidden',
    marginBottom: 12,
  },

  searchBox: {
    minHeight: 58,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 12,
    backgroundColor: '#FAFBF9',
    borderBottomWidth: 1,
    borderBottomColor: '#EDEDED',
  },

  searchInput: {
    flex: 1,
    fontSize: 15,
    color: '#111',
    paddingVertical: 0,
  },

  searchHint: {
    fontSize: 13,
    color: '#777',
    paddingHorizontal: 14,
    paddingVertical: 10,
  },

  suggestionRow: {
    minHeight: 62,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#F0F0F0',
  },

  suggestionTitle: {
    fontSize: 14,
    fontWeight: '800',
    color: '#111',
  },

  suggestionSub: {
    fontSize: 12,
    color: '#777',
    marginTop: 3,
  },

  mapOptionRow: {
    minHeight: 66,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    backgroundColor: '#EDFFE1',
  },

  mapOptionIcon: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
  },

  mapOptionTitle: {
    fontSize: 15,
    fontWeight: '900',
    color: '#111',
  },

  mapOptionSub: {
    fontSize: 12,
    color: '#666',
    marginTop: 2,
  },


  dropSection: {
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#E5E5E5',
    backgroundColor: '#FAFBF9',
    padding: 12,
    marginBottom: 12,
  },

  dropSectionHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 10,
  },

  sectionNumber: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: COLORS.green,
    alignItems: 'center',
    justifyContent: 'center',
  },

  sectionNumberText: {
    fontSize: 13,
    fontWeight: '900',
    color: '#111',
  },

  dropSectionTitle: {
    flex: 1,
    fontSize: 15,
    fontWeight: '900',
    color: '#111',
  },

  modeTabs: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 10,
  },

  modeTab: {
    flex: 1,
    minHeight: 44,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#E5E5E5',
    backgroundColor: '#fff',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingHorizontal: 8,
  },

  modeTabActive: {
    backgroundColor: '#EDFFE1',
    borderColor: COLORS.green,
  },

  modeTabText: {
    fontSize: 12,
    fontWeight: '800',
    color: '#777',
    textAlign: 'center',
  },

  modeTabTextActive: {
    color: '#111',
  },

  paymentMethodRow: {
    minHeight: 64,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingHorizontal: 8,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },

  mapPage: { flex: 1, backgroundColor: '#fff' },

  mapHeader: {
    height: Platform.OS === 'ios' ? 96 : 76,
    paddingTop: Platform.OS === 'ios' ? 46 : 22,
    paddingHorizontal: 20,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },

  mapTitle: { fontSize: 20, fontWeight: '900', color: '#111' },

  mapClose: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F4F4F4',
  },

  mapWebView: { flex: 1, backgroundColor: '#fff' },
});
