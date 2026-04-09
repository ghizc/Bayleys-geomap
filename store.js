// store.js

export const state = {
    // Database Data
    currentUser: null,
    clientsData: [],
    premisesData: [],
    allReportsData: [],
    contactsData: [],
    reportRequestsData: [],
    pricingRules: [],
    airportsData: [],
    officesData: [],
    
    // UI State
    currentMapStyle: null,
    currentGalleryImages: [],
    currentGalleryIndex: 0,
    currentViewedPremise: null,
    
    // Filter State
    activeAdminTab: 'clients',
    currentAdminSubFilter: 'all',
    
    // Modal State
    currentEditReportId: null,
    currentEditJobNo: null,
    currentEditContactId: null,
    
    // Global Map Instance
    mapInstance: null
};