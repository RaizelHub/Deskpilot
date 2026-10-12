<?php

namespace App\Http\Controllers;

use App\Models\Ticket;
use App\Services\Audit;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;

class SlaPolicyController extends Controller
{
    public function index()
    {
        return response()->json(['data' => DB::table('sla_policies')->orderBy('response_minutes')->get()]);
    }

    public function update(Request $request, Audit $audit)
    {
        $data = $request->validate(['policies' => 'required|array|size:4', 'policies.*.priority' => ['required', 'distinct', Rule::in(Ticket::PRIORITIES)], 'policies.*.response_minutes' => 'required|integer|min:1|max:43200', 'policies.*.resolution_minutes' => 'required|integer|min:1|max:43200|gte:policies.*.response_minutes']);
        DB::transaction(function () use ($data, $request, $audit) {
            foreach ($data['policies'] as $policy) {
                DB::table('sla_policies')->where('priority', $policy['priority'])->update(['response_minutes' => $policy['response_minutes'], 'resolution_minutes' => $policy['resolution_minutes'], 'updated_at' => now()]);
            }
            $audit->record('sla.policies_updated', $request->user(), null, ['policies' => $data['policies']]);
        });

        return $this->index();
    }
}
